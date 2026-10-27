/**
 * 新建 / 编辑习惯 — 对齐设计稿 shot 23
 * 类型 morph 280ms · 折叠高度补间 · 积分预览随类型
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { AppButton, AppCard } from '@/components/ui';
import { ProjectTagPickerField } from '@/components/projects/ProjectTagPickerField';
import { EntityIconPickerField } from '@/components/tasks/EntityIconPickerField';
import {
  contextTone,
  formatSignedPoints,
  HabitAccordion,
  HabitCard,
  HabitNameCaret,
  HabitScoreFade,
  HabitSect,
  HabitTile,
  HabitTypeCard,
  HBT_KIND_META,
  HBT_PREVIEWS,
  HBT_SUM,
} from '@/components/tasks/habit-create-chrome';
import { DEFAULT_HABIT_ICON } from '@/lib/constants/entity-icon-choices';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { syncHabitReminderNotification, cancelScheduledHabitReminder } from '@/lib/habit-reminder-notifications';
import { syncScheduleSlotRemindersForHabit } from '@/lib/schedule-slot-reminder-notifications';
import { isHabitSchedulePlaceableCycle } from '@/lib/schedule/habit-virtual-placement';
import { createHabit, deleteHabit, getHabitById, updateHabit } from '@/lib/repositories/habits/habit';
import { getCheckInsMapByHabitId } from '@/lib/repositories/habits/habit-check-in';
import { toast, Alert } from '@/lib/app-feedback';
import { formatWriteError } from '@/lib/format-write-error';
import { markPendingTablesDirty } from '@/lib/api-incremental-sync';
import { requestPush } from '@/lib/sync-manager';
import {
  getTagIdsByEntity,
  getProjectTags,
  setHabitTagIds,
} from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { ensureBreakHabitCycleExtra } from '@/lib/repositories/habits/habit-break-success';
import {
  isBuildHabitSucceeded,
  mergeBuildHabitCycleExtra,
} from '@/lib/repositories/habits/habit-build-success';
import {
  type BuildHabitExpectedGoalType,
  normalizeBuildHabitExpectedGoal,
  parseBuildHabitExpectedGoal,
} from '@/lib/repositories/habits/habit-goal';
import { getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import {
  DEFAULT_TASK_REPEAT_PERIOD,
  describeTaskExpectedGoalConstraints,
  getTaskExpectedGoalMaxValue,
  getTaskExpectedGoalTypeOptions,
  normalizeTaskExpectedGoal,
  TASK_REPEAT_PERIODS,
  type TaskRepeatPeriod,
} from '@/lib/repositories/habits/habit-task-period';
import { type HabitKind, parseHabitKind } from '@/lib/repositories/habits/habit-kind';
import {
  normalizeHabitRewardPoints,
  parseHabitRewardPoints,
} from '@/lib/repositories/habits/habit-reward-points';
import {
  createHabitSubItemId,
  habitSubItemsLabel,
  mergeSubHabitsIntoExtraData,
  parseHabitSubHabitsMeta,
  type HabitSubItem,
} from '@/lib/repositories/habits/habit-sub';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useFocusEffect } from "expo-router/react-navigation";
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ExpectedGoalTab = 'none' | BuildHabitExpectedGoalType;

type CycleTab = '每天' | '每周定期' | '每周N天' | '每月定期' | '每月N天';

const CYCLE_TABS: CycleTab[] = ['每天', '每周N天', '每月N天', '每周定期', '每月定期'];
const TASK_CYCLE_TABS: TaskRepeatPeriod[] = [...TASK_REPEAT_PERIODS];
const EXPECTED_GOAL_TABS: { key: ExpectedGoalTab; label: string }[] = [
  { key: 'none', label: '不限' },
  { key: 'days', label: '按天数' },
  { key: 'times', label: '按次数' },
];

const BUILD_EXPECTED_GOAL_TABS: { key: BuildHabitExpectedGoalType; label: string }[] = [
  { key: 'days', label: '累计天数' },
  { key: 'times', label: '累计次数' },
  { key: 'consecutive_days', label: '连续天数' },
];

const BUILD_EXPECTED_CONDITION_TABS: { key: ExpectedGoalTab; label: string }[] = [
  { key: 'none', label: '不设' },
  ...BUILD_EXPECTED_GOAL_TABS,
];

const WORK_DAYS = ['周一', '周二', '周三', '周四', '周五'];
const WEEKEND_DAYS = ['周六', '周日'];
const MONTH_FILTERS = ['上旬', '中旬', '下旬', '单号', '双号', '全选'];
const PRESET_MONTHLY_N_DAYS = [5, 10, 15, 20, 25];
const DEFAULT_QUANTIFY_UNIT = '次';
/** 小习惯简介（note）最大字数 */
const HABIT_NOTE_MAX_LEN = 50;

/** Habit kind accents — 对齐设计稿 typegrid / .hbt-type */
const HABIT_KIND_BUILD = '#AFC38E';
const HABIT_KIND_BREAK_BORDER = '#C47055';
const HABIT_KIND_TASK = '#D6974B';

type TileKey = 'sub' | 'expected' | 'reminder' | 'cycle' | null;

function defaultReminderTime(): Date {
  const d = new Date();
  d.setHours(20, 0, 0, 0);
  return d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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
  displayValue,
  showOptional = false,
  textColor,
  mutedColor,
  onValuePress,
}: {
  label: string;
  value: number | null;
  onMinus: () => void;
  onPlus: () => void;
  onValuePress?: () => void;
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
        <Pressable onPress={onValuePress} disabled={!onValuePress} hitSlop={6}>
          <Text style={[styles.numberValue, { color: textColor }]}>{displayValue ?? String(value ?? 0)}</Text>
        </Pressable>
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
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const params = useLocalSearchParams<{
    mode?: string;
    name?: string;
    icon?: string;
    context?: string;
    habitId?: string;
    from?: string;
  }>();
  const insets = useSafeAreaInsets();
  const { colors, isDark, scheme, shadows } = useAppTheme();
  const { tf, fonts } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();
  const { boundary: dayBoundary, logicalTodayYmd } = usePageDayBoundary('tasks');

  const isEditMode = pickParam(params.mode) === 'edit';
  const openedFromDetail = pickParam(params.from) === 'detail';
  const initialName = pickParam(params.name) ?? '';
  const initialIcon = pickParam(params.icon) ?? DEFAULT_HABIT_ICON;
  const initialContext = pickParam(params.context);
  const habitId = pickParam(params.habitId);

  const [habitName, setHabitName] = React.useState(initialName);
  const [habitIcon, setHabitIcon] = React.useState(initialIcon);
  const [quantifyEnabled, setQuantifyEnabled] = React.useState(true);
  const [contextOpen, setContextOpen] = React.useState(true);
  const [quantifyOpen, setQuantifyOpen] = React.useState(true);
  const [cycleOpen, setCycleOpen] = React.useState(false);
  const [nameFocused, setNameFocused] = React.useState(false);
  const [scoreFadeKey, setScoreFadeKey] = React.useState(0);
  const [activeTile, setActiveTile] = React.useState<TileKey>(null);
  const [contextOptions, setContextOptions] = React.useState<string[]>([]);
  /** 新建时不预设情境；列表仅来自接口 habit_contexts */
  const [selectedContext, setSelectedContext] = React.useState(() => initialContext?.trim() ?? '');
  const [activeTab, setActiveTab] = React.useState<CycleTab | TaskRepeatPeriod>('每周N天');
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
  const [consecutiveTargetDays, setConsecutiveTargetDays] = React.useState<number | null>(7);
  const [expectedGoalTab, setExpectedGoalTab] = React.useState<ExpectedGoalTab>('none');
  const [expectedGoalValue, setExpectedGoalValue] = React.useState(7);
  const [habitNote, setHabitNote] = React.useState('');
  const [rewardPointsText, setRewardPointsText] = React.useState('0');
  const [breakPenaltyText, setBreakPenaltyText] = React.useState('0');
  const [cleanRewardText, setCleanRewardText] = React.useState('0');
  const [goalRewardText, setGoalRewardText] = React.useState('0');
  const [habitKind, setHabitKind] = React.useState<HabitKind>('build');
  const [deleting, setDeleting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [reminderOpen, setReminderOpen] = React.useState(false);
  // reminderOpen / expectedGoalOpen / subHabitsOpen / cycleOpen：磁贴展开时同步
  const [reminderEnabled, setReminderEnabled] = React.useState(false);
  const [reminderTime, setReminderTime] = React.useState<Date>(() => defaultReminderTime());
  const [reminderTimePickerOpen, setReminderTimePickerOpen] = React.useState(false);
  const [expectedGoalOpen, setExpectedGoalOpen] = React.useState(false);
  const [subHabitsOpen, setSubHabitsOpen] = React.useState(false);
  const [subHabitsEnabled, setSubHabitsEnabled] = React.useState(false);
  const [subHabits, setSubHabits] = React.useState<HabitSubItem[]>([]);
  const [selectedTagIds, setSelectedTagIds] = React.useState<string[]>([]);
  const [allTags, setAllTags] = React.useState<TagRow[]>([]);
  const [tagsLoading, setTagsLoading] = React.useState(true);
  const [subHabitEditor, setSubHabitEditor] = React.useState<{
    visible: boolean;
    editingId: string | null;
    name: string;
  }>({ visible: false, editingId: null, name: '' });
  const [numberEditor, setNumberEditor] = React.useState<{
    visible: boolean;
    label: string;
    value: string;
    min: number;
    max: number;
    onSave: (value: number) => void;
  }>({ visible: false, label: '', value: '0', min: 0, max: 99, onSave: () => undefined });

  const openNumberEditor = React.useCallback(
    (label: string, value: number, min: number, max: number, onSave: (value: number) => void) => {
      setNumberEditor({ visible: true, label, value: String(value), min, max, onSave });
    },
    [],
  );

  const reload = React.useCallback(async (forceRefresh = false) => {
    await wrapLoad(async () => {
    try {
      const rows = await getHabitContexts();
      const nextOptions = Array.from(new Set(rows.map((r) => r.name)));
      setContextOptions(nextOptions);
      // 新建打卡：选中项必须在当前可选列表中
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
    setTagsLoading(true);
    try {
      setAllTags(await getProjectTags());
    } catch (err) {
      console.warn('加载标签失败', err);
      setAllTags([]);
    } finally {
      setTagsLoading(false);
    }
    }, forceRefresh);
  }, [isEditMode, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload])
  );

  const prevLogicalTodayYmdRef = React.useRef(logicalTodayYmd);
  React.useEffect(() => {
    const prev = prevLogicalTodayYmdRef.current;
    if (prev === logicalTodayYmd) return;
    prevLogicalTodayYmdRef.current = logicalTodayYmd;
    if (isEditMode && habitId) void reload();
  }, [habitId, isEditMode, logicalTodayYmd, reload]);

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
        setHabitNote(row.note?.trim() ? row.note.trim().slice(0, HABIT_NOTE_MAX_LEN) : '');
        try {
          setSelectedTagIds(await getTagIdsByEntity('habit', habitId));
        } catch (tagErr) {
          console.warn('加载习惯标签失败', tagErr);
          setSelectedTagIds([]);
        }
        setHabitKind(parseHabitKind(row.extra_data));
        setRewardPointsText(String(parseHabitRewardPoints(row.extra_data)));
        try {
          const extra = row.extra_data ? JSON.parse(row.extra_data) as Record<string, unknown> : {};
          const breakRewards = extra.breakRewards;
          if (breakRewards && typeof breakRewards === 'object' && !Array.isArray(breakRewards)) {
            const values = breakRewards as Record<string, unknown>;
            setBreakPenaltyText(String(values.penalty ?? 0));
            setCleanRewardText(String(values.clean ?? 0));
            setGoalRewardText(String(values.goal ?? 0));
          } else if (parseHabitKind(row.extra_data) === 'break') {
            // 旧版戒除习惯：单一 reward_points 即「达成连续目标」的奖励，迁移到新字段
            setBreakPenaltyText('0');
            setCleanRewardText('0');
            setGoalRewardText(String(parseHabitRewardPoints(row.extra_data)));
          }
        } catch {
          // ignore malformed optional reward metadata
        }
        if (row.extra_data) {
          try {
            const parsed = JSON.parse(row.extra_data) as any;
            const schedule = parsed?.schedule;
            const quantifyEnabledRaw = parsed?.quantifyEnabled;
            const quantify = parsed?.quantify;

            const kindFromExtra = parseHabitKind(row.extra_data);
            if (schedule?.activeTab && typeof schedule.activeTab === 'string') {
              const v = schedule.activeTab;
              if (kindFromExtra === 'task' && (TASK_CYCLE_TABS as string[]).includes(v)) {
                setActiveTab(v as TaskRepeatPeriod);
              } else if (kindFromExtra !== 'task') {
                setActiveTab(v as CycleTab);
              }
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
              const kindFromExtra = parseHabitKind(row.extra_data);
              if (kindFromExtra === 'task') {
                setDailyGoal(null);
              } else if (quantify.dailyGoal === null) {
                setDailyGoal(kindFromExtra === 'break' ? 1 : null);
              } else if (typeof quantify.dailyGoal === 'number') {
                const g = Math.round(quantify.dailyGoal);
                if (kindFromExtra === 'break') {
                  setDailyGoal(Math.min(99, Math.max(1, g)));
                } else if (g <= 0) {
                  setDailyGoal(null);
                } else {
                  setDailyGoal(Math.min(99, Math.max(1, g)));
                }
              }
              if (kindFromExtra === 'break') {
                if (typeof quantify.consecutiveTargetDays === 'number') {
                  const d = Math.round(quantify.consecutiveTargetDays);
                  setConsecutiveTargetDays(d < 1 ? null : Math.min(999, d));
                } else {
                  setConsecutiveTargetDays(null);
                }
              }
              const expected = parseBuildHabitExpectedGoal(row.extra_data);
              if (expected) {
                setExpectedGoalTab(expected.type);
                setExpectedGoalValue(expected.value);
              } else {
                setExpectedGoalTab('none');
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
            const subMeta = parseHabitSubHabitsMeta(row.extra_data);
            setSubHabitsEnabled(subMeta.enabled);
            setSubHabits(subMeta.items);
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

  const taskRepeatPeriod = React.useMemo((): TaskRepeatPeriod => {
    if (habitKind !== 'task') return DEFAULT_TASK_REPEAT_PERIOD;
    return (TASK_CYCLE_TABS as string[]).includes(activeTab)
      ? (activeTab as TaskRepeatPeriod)
      : DEFAULT_TASK_REPEAT_PERIOD;
  }, [habitKind, activeTab]);

  const schedulePlacementHint = React.useMemo(() => {
    if (habitKind !== 'build' && habitKind !== 'task') return null;
    const cycleExtra = JSON.stringify({
      habitKind,
      schedule: { activeTab },
    });
    if (!isHabitSchedulePlaceableCycle(cycleExtra)) {
      return null;
    }
    if (habitKind === 'build' && (activeTab === '每周N天' || activeTab === '每月N天')) {
      return '按循环以全天入格日程表；本周期完成天数达标后，剩余日格子不再显示';
    }
    if (habitKind === 'task') {
      return '按循环以全天入格日程表；本周期完成预期目标后，剩余日格子不再显示';
    }
    return '按循环以全天入格日程表（与提醒开关无关）';
  }, [habitKind, activeTab]);

  const taskGoalTypeOptions = React.useMemo(
    () => getTaskExpectedGoalTypeOptions(taskRepeatPeriod),
    [taskRepeatPeriod]
  );

  const taskGoalMaxValue = React.useMemo(() => {
    if (expectedGoalTab !== 'days' && expectedGoalTab !== 'times') return 1;
    return getTaskExpectedGoalMaxValue(taskRepeatPeriod, expectedGoalTab);
  }, [expectedGoalTab, taskRepeatPeriod]);

  const buildGoalMaxValue = React.useMemo(() => {
    if (expectedGoalTab === 'times') return 9999;
    if (expectedGoalTab === 'days' || expectedGoalTab === 'consecutive_days') return 999;
    return 1;
  }, [expectedGoalTab]);

  React.useEffect(() => {
    if (habitKind !== 'task') return;
    if (
      expectedGoalTab === 'none' ||
      !taskGoalTypeOptions.includes(expectedGoalTab)
    ) {
      setExpectedGoalTab(taskGoalTypeOptions[0]);
    }
  }, [habitKind, expectedGoalTab, taskGoalTypeOptions]);

  React.useEffect(() => {
    if (habitKind !== 'build') return;
    if (expectedGoalTab === 'none') return;
    setExpectedGoalValue((v) => Math.min(buildGoalMaxValue, Math.max(1, v)));
  }, [habitKind, expectedGoalTab, buildGoalMaxValue]);

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

  React.useEffect(() => {
    if (habitKind === 'break') {
      setQuantifyEnabled(true);
      setDailyGoal((v) => (v === null || v < 1 ? 1 : v));
      setExpectedGoalTab('none');
    } else if (habitKind === 'task') {
      setDailyGoal(null);
      setExpectedGoalTab((tab) => {
        if (tab === 'consecutive_days' || tab === 'none') {
          return taskRepeatPeriod === '每日' ? 'times' : 'days';
        }
        return tab;
      });
      setExpectedGoalValue((v) => (v < 1 ? (taskRepeatPeriod === '每日' ? 1 : 7) : v));
      if (!(TASK_CYCLE_TABS as string[]).includes(activeTab)) {
        setActiveTab(DEFAULT_TASK_REPEAT_PERIOD);
      }
    } else {
      setDailyGoal((v) => (v === 0 ? null : v));
      setExpectedGoalTab((tab) =>
        tab === 'none' || tab === 'days' || tab === 'times' || tab === 'consecutive_days' ? tab : 'days'
      );
      if ((TASK_CYCLE_TABS as string[]).includes(activeTab)) {
        setActiveTab('每周N天');
      }
    }
  }, [activeTab, habitKind, taskRepeatPeriod]);

  const deriveTagByCycle = React.useCallback((): string => {
    if (habitKind === 'break') return '每天';
    if (habitKind === 'task') {
      return (TASK_CYCLE_TABS as string[]).includes(activeTab) ? activeTab : DEFAULT_TASK_REPEAT_PERIOD;
    }
    if (activeTab === '每天') return '每天';
    if (activeTab === '每周N天') return `每周${weeklyNDays}天`;
    if (activeTab === '每月N天') return `每月${monthlyNDays}天`;
    if (activeTab === '每周定期') return '每周定期';
    if (activeTab === '每月定期') return '每月定期';
    return '每天';
  }, [activeTab, habitKind, monthlyNDays, weeklyNDays]);

  const handleSave = React.useCallback(async () => {
    if (saving || deleting) return;
    const name = habitName.trim();
    if (!name) {
      toast.warn('请先输入习惯名称');
      return;
    }

    setSaving(true);
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
    delete existingExtra.completion_reward;

    const unitResolved = unitInput.trim() || DEFAULT_QUANTIFY_UNIT;

    const reminderPayload = reminderEnabled
      ? { enabled: true as const, hour: reminderTime.getHours(), minute: reminderTime.getMinutes() }
      : { enabled: false as const };

    const resolvedDailyGoal =
      habitKind === 'task'
        ? null
        : habitKind === 'break'
          ? Math.min(99, Math.max(1, dailyGoal ?? 1))
          : dailyGoal !== null && dailyGoal < 1
            ? null
            : dailyGoal;

    const prevExpectedGoal =
      isEditMode && habitId
        ? parseBuildHabitExpectedGoal(JSON.stringify(existingExtra))
        : null;
    const nextTaskExpectedGoal =
      habitKind === 'task' &&
      expectedGoalTab !== 'none' &&
      (expectedGoalTab === 'days' || expectedGoalTab === 'times')
        ? normalizeTaskExpectedGoal(taskRepeatPeriod, {
            type: expectedGoalTab,
            value: expectedGoalValue,
          })
        : null;
    const nextBuildExpectedGoal =
      habitKind === 'build' &&
      expectedGoalTab !== 'none' &&
      (expectedGoalTab === 'days' ||
        expectedGoalTab === 'times' ||
        expectedGoalTab === 'consecutive_days')
        ? normalizeBuildHabitExpectedGoal({
            type: expectedGoalTab,
            value: expectedGoalValue,
          })
        : null;

    const taskQuantifyExtra =
      habitKind === 'task' && nextTaskExpectedGoal ? { expectedGoal: nextTaskExpectedGoal } : {};
    const buildQuantifyExtra =
      habitKind === 'build' && nextBuildExpectedGoal ? { expectedGoal: nextBuildExpectedGoal } : {};

    const canUseSubHabits = true;
    const resolvedSubEnabled = canUseSubHabits && subHabitsEnabled;

    const breakRewardsPayload =
      habitKind === 'break'
        ? {
            penalty: normalizeHabitRewardPoints(breakPenaltyText),
            clean: normalizeHabitRewardPoints(cleanRewardText),
            goal: normalizeHabitRewardPoints(goalRewardText),
          }
        : null;

    const extraDataRaw = mergeSubHabitsIntoExtraData(
      JSON.stringify({
        ...existingExtra,
        habitKind,
        ...(breakRewardsPayload
          ? { breakRewards: breakRewardsPayload }
          : { reward_points: normalizeHabitRewardPoints(rewardPointsText) }),
        quantifyEnabled,
        quantify: quantifyEnabled
          ? {
              unit: unitResolved,
              eachPlus,
              dailyGoal: resolvedDailyGoal,
              ...(habitKind === 'break'
                ? {
                    consecutiveTargetDays:
                      consecutiveTargetDays == null
                        ? null
                        : Math.min(999, Math.max(1, consecutiveTargetDays)),
                  }
                : {}),
              ...taskQuantifyExtra,
              ...buildQuantifyExtra,
            }
          : habitKind === 'task' && nextTaskExpectedGoal
            ? { expectedGoal: nextTaskExpectedGoal }
            : habitKind === 'build' && nextBuildExpectedGoal
              ? { expectedGoal: nextBuildExpectedGoal }
              : null,
        schedule:
          habitKind === 'task'
            ? { activeTab: (TASK_CYCLE_TABS as string[]).includes(activeTab) ? activeTab : DEFAULT_TASK_REPEAT_PERIOD }
            : habitKind === 'break'
              ? { activeTab: '每天' }
              : {
                activeTab,
                selectedDays,
                weeklyNDays,
                monthlyFilter: activeMonthlyFilter,
                monthlySpecificDays,
                monthlyNDays,
              },
        reminder: reminderPayload,
      }),
      {
        enabled: resolvedSubEnabled,
        items: canUseSubHabits ? subHabits : [],
      },
    );
    let extraData = extraDataRaw;
    if (habitKind === 'break') {
      let cycleStartedAt: string | null = null;
      if (!isEditMode) {
        cycleStartedAt = getLogicalLocalYmd(new Date(), dayBoundary);
      }
      extraData = ensureBreakHabitCycleExtra(extraDataRaw, cycleStartedAt);
      const extraObj = JSON.parse(extraData) as Record<string, unknown>;
      delete extraObj.buildHabitCycle;
      delete extraObj.completion_reward;
      delete extraObj.reward_points;
      extraData = JSON.stringify(extraObj);
    } else if (habitKind === 'build') {
      const extraObj = JSON.parse(extraData) as Record<string, unknown>;
      delete extraObj.breakHabitCycle;
      delete extraObj.completion_reward;
      let merged = JSON.stringify(extraObj);
      const goalRemoved = nextBuildExpectedGoal == null;
      const goalChanged =
        prevExpectedGoal != null &&
        nextBuildExpectedGoal != null &&
        (prevExpectedGoal.type !== nextBuildExpectedGoal.type ||
          prevExpectedGoal.value !== nextBuildExpectedGoal.value);
      if (goalRemoved || goalChanged || (goalRemoved && isBuildHabitSucceeded(merged))) {
        merged = mergeBuildHabitCycleExtra(merged, { completedAt: null, completedValue: null });
      }
      extraData = merged;
    } else if (habitKind === 'task') {
      const extraObj = JSON.parse(extraData) as Record<string, unknown>;
      delete extraObj.breakHabitCycle;
      delete extraObj.buildHabitCycle;
      delete extraObj.completion_reward;
      extraData = JSON.stringify(extraObj);
    }

    const note = habitNote.trim().slice(0, HABIT_NOTE_MAX_LEN) || null;

    let savedHabitId: string;
    try {
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
      await setHabitTagIds(savedHabitId, selectedTagIds);
      try {
        await markPendingTablesDirty(['habits', 'tags', 'tag_links']);
        // 本地已写入；后台推送即可，勿 awaitSync 阻塞返回（否则其它脏表卡住时页面无反应）
        void requestPush();
      } catch (syncErr) {
        console.warn('习惯保存后同步到服务器失败', syncErr);
      }
    } catch (err) {
      toast.error(formatWriteError(err, '保存失败，请稍后重试'));
      setSaving(false);
      return;
    }

    notifyAncestorsDataChanged();
    setSaving(false);
    toast.success(isEditMode ? '已保存' : '已创建');
    router.back();

    // 本地已落库并返回；提醒重排走后台，避免「保存中…」被 OS 通知 API / 全量重登记拖死
    const reminderHabitId = savedHabitId;
    const reminderTitle = name;
    const reminderOn = reminderEnabled;
    const reminderHour = reminderTime.getHours();
    const reminderMinute = reminderTime.getMinutes();
    const reminderExtraData = extraData;
    void (async () => {
      try {
        // 保存页已有 extraData；打卡图读一次后复用，避免单习惯提醒与入格提醒各查一遍
        const checkIns = await getCheckInsMapByHabitId(reminderHabitId);
        const { permissionDenied: habitPermDenied } = await syncHabitReminderNotification({
          habitId: reminderHabitId,
          enabled: reminderOn,
          hour: reminderHour,
          minute: reminderMinute,
          title: reminderTitle,
          extraData: reminderExtraData,
          checkIns,
        });
        let schedulePermDenied = false;
        try {
          // 只重排当前习惯的虚拟入格提醒，避免全量推倒任务/其它习惯
          const scheduleResult = await syncScheduleSlotRemindersForHabit(reminderHabitId, {
            checkIns,
          });
          schedulePermDenied = scheduleResult.permissionDenied;
        } catch (e) {
          console.warn('同步日程格提醒失败', e);
        }
        if (reminderOn && (habitPermDenied || schedulePermDenied)) {
          Alert.alert(
            '提示',
            '已保存习惯，但系统未授予通知权限，日程提醒将无法送达。可在系统设置中为本应用开启通知。'
          );
        }
      } catch (reminderErr) {
        console.warn('习惯提醒同步失败', reminderErr);
      }
    })();
  }, [
    activeMonthlyFilter,
    activeTab,
    consecutiveTargetDays,
    dailyGoal,
    dayBoundary,
    deleting,
    expectedGoalTab,
    expectedGoalValue,
    taskRepeatPeriod,
    deriveTagByCycle,
    deriveToneByContext,
    habitIcon,
    habitId,
    habitKind,
    habitName,
    habitNote,
    rewardPointsText,
    breakPenaltyText,
    cleanRewardText,
    goalRewardText,
    eachPlus,
    isEditMode,
    monthlyNDays,
    monthlySpecificDays,
    notifyAncestorsDataChanged,
    quantifyEnabled,
    reminderEnabled,
    reminderTime,
    router,
    saving,
    selectedContext,
    selectedDays,
    selectedTagIds,
    unitInput,
    weeklyNDays,
    subHabits,
    subHabitsEnabled,
  ]);

  const leaveAfterDelete = React.useCallback(() => {
    notifyAncestorsDataChanged();
    if (openedFromDetail) {
      // 详情 → 编辑：连同详情一并退出，避免停在「未找到该习惯」
      if (typeof router.dismiss === 'function') {
        try {
          router.dismiss(2);
          return;
        } catch {
          /* fall through */
        }
      }
      router.replace('/habit-manage');
      return;
    }
    router.back();
  }, [notifyAncestorsDataChanged, openedFromDetail, router]);

  const handleDelete = React.useCallback(() => {
    if (!isEditMode || !habitId || deleting) return;
    const name = habitName.trim() || '该习惯';
    Alert.alert('删除习惯', `确认删除「${name}」吗？删除后打卡记录一并清除，且无法找回。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setDeleting(true);
            try {
              await deleteHabit(habitId);
              void cancelScheduledHabitReminder(habitId);
              toast.success('已删除');
              leaveAfterDelete();
            } catch (err) {
              console.warn('删除习惯失败', err);
              toast.error(formatWriteError(err, '习惯删除失败，请稍后重试。'));
            } finally {
              setDeleting(false);
            }
          })();
        },
      },
    ]);
  }, [deleting, habitId, habitName, isEditMode, leaveAfterDelete]);

  const runAccLayout = React.useCallback(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
    LayoutAnimation.configureNext(
      LayoutAnimation.create(TaskFoldMotion.habitAccExpand, 'easeInEaseOut', 'opacity'),
    );
  }, []);

  const toggleAccordion = React.useCallback(
    (which: 'context' | 'quantify') => {
      runAccLayout();
      if (which === 'context') setContextOpen((v) => !v);
      else setQuantifyOpen((v) => !v);
    },
    [runAccLayout],
  );

  const toggleTile = React.useCallback(
    (key: Exclude<TileKey, null>) => {
      runAccLayout();
      setActiveTile((prev) => {
        const next = prev === key ? null : key;
        setSubHabitsOpen(next === 'sub');
        setExpectedGoalOpen(next === 'expected');
        setReminderOpen(next === 'reminder');
        setCycleOpen(next === 'cycle');
        return next;
      });
    },
    [runAccLayout],
  );

  const setKindWithMorph = (next: HabitKind) => {
    if (next === habitKind) return;
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
    LayoutAnimation.configureNext(
      LayoutAnimation.create(TaskFoldMotion.habitTypeMorph, 'easeInEaseOut', 'opacity'),
    );
    setHabitKind(next);
    setScoreFadeKey((k) => k + 1);
    toast.info(HBT_KIND_META[next].toast);
    if (next !== 'build' && activeTile === 'expected') {
      setActiveTile(null);
      setExpectedGoalOpen(false);
    }
  };

  const stepReward = (delta: number) => {
    const cur = normalizeHabitRewardPoints(rewardPointsText);
    const next = Math.round((cur + delta) * 100) / 100;
    setRewardPointsText(String(next));
  };

  const rewardPts = normalizeHabitRewardPoints(rewardPointsText);
  const breakPen = normalizeHabitRewardPoints(breakPenaltyText);
  const breakClean = normalizeHabitRewardPoints(cleanRewardText);
  const breakGoal = normalizeHabitRewardPoints(goalRewardText);
  const kindMeta = HBT_KIND_META[habitKind];
  const subLabel = habitSubItemsLabel(habitKind);
  const cycleSummary =
    habitKind === 'break'
      ? '每天（固定）'
      : habitKind === 'task'
        ? String(activeTab)
        : activeTab === '每周N天'
          ? `每周${weeklyNDays}天`
          : activeTab === '每月N天'
            ? `每月${monthlyNDays}天`
            : String(activeTab);
  const expectedSummary =
    habitKind === 'build'
      ? expectedGoalTab === 'none'
        ? '未设'
        : expectedGoalTab === 'times'
          ? `累计 ${expectedGoalValue} 次`
          : expectedGoalTab === 'consecutive_days'
            ? `连续 ${expectedGoalValue} 天`
            : `累计 ${expectedGoalValue} 天`
      : '';
  const reminderSummary = reminderEnabled
    ? `${pad2(reminderTime.getHours())}:${pad2(reminderTime.getMinutes())}`
    : '未开启';
  const previewEms = (em: string): string => {
    if (em === 'pts') return formatSignedPoints(rewardPts);
    if (em === 'makeup')
      return formatSignedPoints(
        Math.max(0, Math.min(2, Math.round(Math.abs(rewardPts) * 0.4) || 0)),
      );
    if (em === 'pen') return breakPen === 0 ? '0' : `−${Math.abs(breakPen)}`;
    if (em === 'clean') return formatSignedPoints(breakClean);
    if (em === 'goal') return formatSignedPoints(breakGoal);
    if (em === 'neg') return formatSignedPoints(-Math.abs(rewardPts));
    return em;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>
            {isEditMode ? '编辑习惯' : '新建习惯'}
          </Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
            类型决定积分与打卡逻辑
          </Text>
        </View>
        <Pressable
          onPress={() => void handleSave()}
          disabled={deleting || saving}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: deleting || saving ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>
            {isEditMode ? (saving ? '保存中…' : '保存') : saving ? '创建中…' : '保存'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing['7xl'] + 72 + Math.max(insets.bottom, Spacing.md) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.main}>
          {/* —— 身份卡 —— */}
          <FoldRiseIn animate={foldAnimate} index={0} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
            <HabitCard style={styles.identityCard}>
              <View style={styles.identityRow}>
                <EntityIconPickerField
                  compact
                  value={habitIcon}
                  onChange={setHabitIcon}
                  fallback={DEFAULT_HABIT_ICON}
                  accessibilityLabel="选择习惯图标"
                  style={[
                    styles.hbtIcon,
                    {
                      backgroundColor: isDark ? tf.lily2 : undefined,
                      borderColor: isDark ? tf.line2 : '#C6D6AE',
                    },
                  ]}
                />
                <View style={styles.idMain}>
                  <View style={styles.nameLine}>
                    <TextInput
                      value={habitName}
                      onChangeText={setHabitName}
                      placeholder="输入习惯名称…"
                      placeholderTextColor={tf.faint}
                      maxLength={24}
                      onFocus={() => setNameFocused(true)}
                      onBlur={() => setNameFocused(false)}
                      style={[
                        styles.hbtName,
                        { color: tf.ink, fontFamily: fonts.serif },
                        Platform.OS === 'android' ? { includeFontPadding: false } : null,
                      ]}
                    />
                    <HabitNameCaret visible={nameFocused} />
                  </View>
                  <Text style={[styles.hbtMeta, { color: tf.faint }]}>衬线名称 · 最多 24 字</Text>
                </View>
                {!habitName.trim() ? (
                  <Text style={styles.requiredBadge}>必填</Text>
                ) : null}
              </View>
              <View style={[styles.descRow, { borderTopColor: tf.line }]}>
                <Text style={{ fontSize: 11, color: tf.faint }}>
                  简介 <Text style={{ color: '#B0B6AE' }}>可选</Text>
                </Text>
                <TextInput
                  value={habitNote}
                  onChangeText={(t) => setHabitNote(t.slice(0, HABIT_NOTE_MAX_LEN))}
                  placeholder="一句话说明…"
                  placeholderTextColor={tf.faint}
                  maxLength={HABIT_NOTE_MAX_LEN}
                  style={[styles.descInput, { color: tf.ink2 }]}
                />
                <Text style={{ fontSize: 10, fontFamily: fonts.mono, color: '#B0B7AE' }}>
                  {habitNote.length}/{HABIT_NOTE_MAX_LEN}
                </Text>
              </View>
              <View style={styles.tagsRow}>
                <ProjectTagPickerField
                  selectedIds={selectedTagIds}
                  allTags={allTags}
                  loading={tagsLoading}
                  onChange={setSelectedTagIds}
                  textColor={colors.text}
                  outline={colors.textSecondary}
                  placeholderColor={colors.textMuted}
                  primary={colors.primary}
                  surfaceLow={colors.input}
                  surfaceLowest={colors.surface}
                  isDark={isDark}
                />
              </View>
            </HabitCard>
          </FoldRiseIn>

          {/* —— 打卡类型 —— */}
          <FoldRiseIn animate={foldAnimate} index={1} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
            <HabitCard>
              <HabitSect title="打卡类型" hint="切换后字段形变" count="3 选 1" />
              <View style={styles.typeRow}>
                {(['build', 'break', 'task'] as HabitKind[]).map((k) => (
                  <HabitTypeCard
                    key={k}
                    kind={k}
                    selected={habitKind === k}
                    onPress={() => setKindWithMorph(k)}
                  />
                ))}
              </View>
              <View style={[styles.typeNote, { backgroundColor: isDark ? tf.paper2 : 'rgba(241,237,225,0.7)' }]}>
                <View
                  style={[
                    styles.typeDot,
                    {
                      backgroundColor:
                        habitKind === 'break' ? HABIT_KIND_BREAK_BORDER : habitKind === 'task' ? HABIT_KIND_TASK : HABIT_KIND_BUILD,
                    },
                  ]}
                />
                <Text style={[styles.typeNoteText, { color: tf.ink2 }]} numberOfLines={1}>
                  {kindMeta.note}
                </Text>
                <Text style={{ marginLeft: 'auto', fontSize: 10, color: tf.faint }}>{kindMeta.noteTag}</Text>
              </View>
            </HabitCard>
          </FoldRiseIn>

          {/* —— 积分配置 —— */}
          <FoldRiseIn animate={foldAnimate} index={2} duration={420} staggerMs={36} fromY={8} holdHidden={foldAnimate}>
            <HabitScoreFade animateKey={scoreFadeKey}>
              <HabitCard style={styles.scoreCard}>
                <HabitSect title="积分配置" hint="可为负 · 支持小数" count={kindMeta.badge} />
                {habitKind === 'break' ? (
                  <>
                    <View style={styles.breakGrid}>
                      <View style={styles.breakCell}>
                        <Text style={styles.breakCellLabel}>破戒扣分</Text>
                        <TextInput
                          value={breakPenaltyText}
                          onChangeText={setBreakPenaltyText}
                          keyboardType="numbers-and-punctuation"
                          style={[styles.breakCellInput, { color: '#A25740', fontFamily: fonts.mono }]}
                        />
                      </View>
                      <View style={styles.breakCell}>
                        <Text style={styles.breakCellLabel}>未破戒加分</Text>
                        <TextInput
                          value={cleanRewardText}
                          onChangeText={setCleanRewardText}
                          keyboardType="numbers-and-punctuation"
                          style={[styles.breakCellInput, { color: '#4F7450', fontFamily: fonts.mono }]}
                        />
                      </View>
                      <View style={styles.breakCell}>
                        <Text style={styles.breakCellLabel}>达成加分</Text>
                        <TextInput
                          value={goalRewardText}
                          onChangeText={setGoalRewardText}
                          keyboardType="numbers-and-punctuation"
                          style={[styles.breakCellInput, { color: '#4F7450', fontFamily: fonts.mono }]}
                        />
                      </View>
                    </View>
                    <Text style={[styles.breakNote, { color: '#A08377' }]}>
                      连续目标{' '}
                      <Text style={{ color: '#8E5A43', fontFamily: fonts.mono, fontWeight: '700' }}>
                        {consecutiveTargetDays == null ? '无限' : `${consecutiveTargetDays} 天`}
                      </Text>
                      {' · '}破戒按当日次数累计扣分
                    </Text>
                  </>
                ) : (
                  <View
                    style={[
                      styles.scoreMain,
                      {
                        borderColor: habitKind === 'task' ? '#EBD4AE' : '#E1E6D4',
                        backgroundColor:
                          habitKind === 'task'
                            ? isDark
                              ? tf.scoreFrom
                              : '#FAF0DF'
                            : isDark
                              ? tf.lily2
                              : '#F2F5E9',
                      },
                    ]}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: tf.ink2 }}>{kindMeta.scoreLabel}</Text>
                      <Text style={{ fontSize: 10, color: tf.faint, marginTop: 2 }}>{kindMeta.scoreDesc}</Text>
                    </View>
                    <Pressable
                      onPress={() =>
                        openNumberEditor('奖励积分', Math.round(rewardPts) || 0, -999, 999, (v) =>
                          setRewardPointsText(String(v)),
                        )
                      }
                      hitSlop={6}>
                      <View style={styles.scoreNum}>
                        <Text
                          style={{
                            fontSize: 22,
                            fontWeight: '700',
                            fontFamily: fonts.mono,
                            color: habitKind === 'task' ? '#9C6B2B' : '#355E45',
                          }}>
                          {formatSignedPoints(rewardPts)}
                        </Text>
                        <Text style={{ fontSize: 10, color: tf.muted }}>分</Text>
                      </View>
                    </Pressable>
                    <View style={styles.scoreStep}>
                      <Pressable
                        onPress={() => stepReward(-1)}
                        style={({ pressed }) => [styles.scoreStepBtn, pressed && { opacity: 0.75 }]}>
                        <Text style={{ color: tf.ink2, fontSize: 14 }}>−</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => stepReward(1)}
                        style={({ pressed }) => [styles.scoreStepBtn, pressed && { opacity: 0.75 }]}>
                        <Text style={{ color: tf.ink2, fontSize: 14 }}>＋</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                <View style={styles.previewGrid}>
                  {HBT_PREVIEWS[habitKind].map((p) => (
                    <View
                      key={p.b}
                      style={[styles.previewCell, { backgroundColor: isDark ? tf.paper2 : '#F4F0E6' }]}>
                      <View
                        style={[
                          styles.previewIcon,
                          p.tone === 'ok'
                            ? { backgroundColor: '#E4ECDA' }
                            : p.tone === 'cont'
                              ? { backgroundColor: '#F3EAD8' }
                              : p.tone === 'make'
                                ? { backgroundColor: '#E8EEF0' }
                                : p.tone === 'pen'
                                  ? { backgroundColor: '#F5E1D9' }
                                  : { backgroundColor: '#EEEAE0' },
                        ]}>
                        {p.icon === '0' ? (
                          <Text style={{ fontSize: 10, fontFamily: fonts.mono, color: '#A5ABA3' }}>0</Text>
                        ) : (
                          <MaterialIcons
                            name={p.icon}
                            size={12}
                            color={
                              p.tone === 'ok'
                                ? '#557048'
                                : p.tone === 'cont'
                                  ? '#9A6C2E'
                                  : p.tone === 'make'
                                    ? '#5E7478'
                                    : p.tone === 'pen'
                                      ? '#A25740'
                                      : '#A5ABA3'
                            }
                          />
                        )}
                      </View>
                      <Text style={{ fontSize: 10, color: tf.faint }} numberOfLines={1}>
                        {p.b}
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: tf.ink2, marginTop: 1 }}>
                        {previewEms(p.em)}
                      </Text>
                    </View>
                  ))}
                </View>
              </HabitCard>
            </HabitScoreFade>
          </FoldRiseIn>

          <View style={styles.optDivider}>
            <View style={[styles.optLine, { backgroundColor: tf.line }]} />
            <Text style={[styles.optLabel, { color: tf.muted }]}>下列为可选设置</Text>
            <View style={[styles.optLine, { backgroundColor: tf.line }]} />
            <Text style={{ fontSize: 10, color: tf.faint }}>按需展开</Text>
          </View>

          <HabitAccordion
            open={contextOpen}
            onToggle={() => toggleAccordion('context')}
            icon={<Text style={{ fontSize: 13 }}>🌅</Text>}
            iconTone="rose"
            title="打卡情境"
            subtitle="会影响主屏分组与卡片底色"
            summary={selectedContext || '未选'}>
            <View style={styles.toneChips}>
              {contextOptions.map((ctx, i) => {
                const active = ctx === selectedContext;
                const tone = contextTone(i);
                return (
                  <Pressable
                    key={ctx}
                    onPress={() => setSelectedContext(ctx)}
                    style={[
                      styles.toneChip,
                      {
                        backgroundColor: tone.bg,
                        borderColor: active ? tf.frog : tone.border,
                        borderWidth: active ? 1.5 : 1,
                      },
                    ]}>
                    <Text style={{ fontSize: 12, color: tone.fg, fontWeight: active ? '700' : '500' }}>{ctx}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => router.push('/habit-context')}
                style={[styles.toneChipAdd, { borderColor: tf.line2 }]}>
                <Text style={{ color: tf.muted, fontSize: 14 }}>＋</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/habit-context')} hitSlop={6}>
                <Text style={{ fontSize: 11, color: tf.muted }}>管理 ›</Text>
              </Pressable>
            </View>
            <Text style={[styles.hbtHint, { color: tf.faint }]}>
              新建时聚焦拉取 habit_contexts；选中项不在列表则回落到第一项。
            </Text>
          </HabitAccordion>

          <HabitAccordion
            open={quantifyOpen}
            onToggle={() => toggleAccordion('quantify')}
            icon={<MaterialIcons name="bar-chart" size={14} color="#5C7B54" />}
            iconTone="green"
            title="量化记录"
            subtitle="关掉后仅记录「做过 / 没做」"
            headerRight={
              <Pressable
                onPress={() => {
                  if (habitKind === 'break') {
                    toast.info('戒除类量化记录强制开启，不可关闭');
                    return;
                  }
                  setQuantifyEnabled((v) => !v);
                }}
                style={[
                  styles.switchTrack,
                  habitKind === 'break' && styles.switchForced,
                  {
                    backgroundColor: quantifyEnabled ? colors.successSwitch : colors.capsule,
                  },
                ]}>
                <View style={[styles.switchDot, quantifyEnabled && styles.switchDotOn]} />
              </Pressable>
            }>
            <View style={styles.quantifyTop}>
              <View>
                <Text style={[Typography.bodyStrong, styles.quantifyTitle, { color: colors.text }]}>启用量化记录</Text>
                <Text style={[Typography.caption, styles.quantifyHint, { color: colors.textSecondary }]}>
                  追踪喝水杯数、运动时长等数值
                </Text>
              </View>
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
                      onValuePress={() => openNumberEditor('每次 +', eachPlus, 1, 99, setEachPlus)}
                      textColor={colors.text}
                      mutedColor={colors.textSecondary}
                    />
                    {habitKind !== 'task' ? (
                      <NumberControl
                        label="每日目标"
                        value={habitKind === 'break' ? (dailyGoal ?? 1) : dailyGoal}
                        displayValue={
                          habitKind === 'break'
                            ? String(dailyGoal ?? 1)
                            : dailyGoal === null
                              ? '不限'
                              : String(dailyGoal)
                        }
                        onMinus={() =>
                          setDailyGoal((v) => {
                            if (habitKind === 'break') {
                              return Math.max(1, (v ?? 1) - 1);
                            }
                            if (v === null) return null;
                            if (v <= 1) return null;
                            return v - 1;
                          })
                        }
                        onPlus={() =>
                          setDailyGoal((v) => {
                            if (habitKind === 'break') return Math.min(99, (v ?? 1) + 1);
                            return v === null ? 1 : Math.min(99, v + 1);
                          })
                        }
                        onValuePress={() =>
                          openNumberEditor(
                            '每日目标',
                            habitKind === 'break' ? dailyGoal ?? 1 : dailyGoal ?? 1,
                            1,
                            99,
                            (v) => setDailyGoal(v),
                          )
                        }
                        showOptional={habitKind !== 'break'}
                        textColor={colors.text}
                        mutedColor={colors.textSecondary}
                      />
                    ) : null}
                    {habitKind === 'break' ? (
                      <>
                        <Text style={[Typography.caption, styles.quantifyBreakHint, { color: colors.textSecondary }]}>
                          当日记录次数低于此值视为达成目标（1 表示零次破戒）；达到此值起每次破戒才扣分
                        </Text>
                        <NumberControl
                          label="连续目标天数"
                          value={consecutiveTargetDays}
                          displayValue={consecutiveTargetDays === null ? '无限' : String(consecutiveTargetDays)}
                          onMinus={() =>
                            setConsecutiveTargetDays((v) => {
                              if (v === null) return null;
                              if (v <= 1) return null;
                              return v - 1;
                            })
                          }
                          onPlus={() =>
                            setConsecutiveTargetDays((v) => (v === null ? 1 : Math.min(999, v + 1)))
                          }
                          onValuePress={() =>
                            openNumberEditor(
                              '连续目标天数',
                              consecutiveTargetDays ?? 7,
                              1,
                              999,
                              setConsecutiveTargetDays,
                            )
                          }
                          showOptional
                          textColor={colors.text}
                          mutedColor={colors.textSecondary}
                        />
                      </>
                    ) : null}
                  </View>
                ) : null}
                {habitKind === 'task' ? (
                  <View
                    style={[
                      styles.expectedGoalBlock,
                      quantifyEnabled && { borderTopColor: colors.outline, borderTopWidth: StyleSheet.hairlineWidth },
                    ]}>
                    <Text style={[Typography.bodyStrong, styles.numberLabel, { color: colors.text }]}>
                      预期目标
                    </Text>
                    <Text style={[Typography.caption, styles.expectedGoalHint, { color: colors.textSecondary }]}>
                      在当前重复周期内达成后，本周期内不再展示；下一周期重新出现
                    </Text>
                    <Text style={[Typography.caption, styles.expectedGoalHint, { color: colors.textSecondary }]}>
                      {describeTaskExpectedGoalConstraints(taskRepeatPeriod)}
                    </Text>
                    <View style={styles.expectedGoalTabs}>
                      {EXPECTED_GOAL_TABS.filter(
                        (tab) => tab.key !== 'none' && taskGoalTypeOptions.includes(tab.key)
                      ).map((tab) => {
                        const active = expectedGoalTab === tab.key;
                        return (
                          <Pressable
                            key={tab.key}
                            onPress={() => {
                              setExpectedGoalTab(tab.key);
                              const max = getTaskExpectedGoalMaxValue(
                                taskRepeatPeriod,
                                tab.key as BuildHabitExpectedGoalType,
                              );
                              setExpectedGoalValue((v) => {
                                const next = tab.key === 'times' && v < 1 ? 1 : Math.max(1, v);
                                return Math.min(max, next);
                              });
                            }}
                            style={[
                              styles.expectedGoalTab,
                              active
                                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                                : { backgroundColor: colors.surface, borderColor: colors.outline },
                            ]}>
                            <Text
                              style={[
                                Typography.bodyStrong,
                                styles.expectedGoalTabText,
                                { color: active ? colors.onPrimary : colors.textSecondary },
                              ]}>
                              {tab.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <NumberControl
                      label={expectedGoalTab === 'times' ? '目标次数' : '目标天数'}
                      value={expectedGoalValue}
                      onMinus={() => setExpectedGoalValue((v) => Math.max(1, v - 1))}
                      onPlus={() =>
                        setExpectedGoalValue((v) => Math.min(taskGoalMaxValue, v + 1))
                      }
                      textColor={colors.text}
                      mutedColor={colors.textSecondary}
                    />
                  </View>
                ) : null}
            <Text style={[styles.hbtHint, { color: tf.faint, marginTop: 6 }]}>
              {habitKind === 'break'
                ? '无记录 ≠ 达标；任一子习惯破戒，当日整体破戒。'
                : habitKind === 'task'
                  ? '周期内达标才发积分；达标次日隐藏，下周期再现。'
                  : '次数达到目标即算达标；0 次时不发积分。'}
            </Text>
          </HabitAccordion>

          {/* —— 2×2 磁贴 —— */}
          <View style={[styles.tilesCard, { backgroundColor: tf.card, borderColor: tf.line2 }]}>
            <View style={styles.tilesGrid}>
              <HabitTile
                icon={<Text style={{ fontSize: 11 }}>☑</Text>}
                iconTone="green"
                title={subLabel.section}
                subtitle={
                  habitKind === 'break'
                    ? '任一项破戒即整日破'
                    : habitKind === 'task'
                      ? '进度按周期保留'
                      : '全部完成才计父打卡'
                }
                trailing={subHabitsEnabled ? `${subHabits.length} 项 ›` : '关 ›'}
                onPress={() => toggleTile('sub')}
              />
              {habitKind === 'build' ? (
                <HabitTile
                  icon={<MaterialIcons name="flag" size={12} color="#9C6B2B" />}
                  iconTone="amber"
                  title="预期目标"
                  subtitle={expectedSummary}
                  trailing={expectedGoalTab === 'none' ? '未设 ›' : '已设 ›'}
                  onPress={() => toggleTile('expected')}
                />
              ) : null}
              <HabitTile
                icon={<MaterialIcons name="notifications-none" size={12} color="#5A7680" />}
                iconTone="blue"
                title="提醒"
                subtitle={reminderSummary}
                trailing={reminderEnabled ? '开 ›' : '关 ›'}
                onPress={() => toggleTile('reminder')}
              />
              <HabitTile
                icon={<MaterialIcons name="repeat" size={12} color="#74627A" />}
                iconTone="violet"
                title="重复"
                subtitle={
                  habitKind === 'break'
                    ? '每天（固定，不可改）'
                    : `${cycleSummary} · 可改周期`
                }
                trailing={habitKind === 'break' ? '固定 ›' : `${cycleSummary} ›`}
                wide={habitKind !== 'build'}
                onPress={() => {
                  if (habitKind === 'break') {
                    toast.info('戒除坏习惯固定按每天记录');
                    return;
                  }
                  toggleTile('cycle');
                }}
              />
            </View>
          </View>

          {activeTile === 'sub' ? (
            <AppCard variant="default" padded={false} style={styles.sectionCardInner}>
                  <View style={styles.quantifyTop}>
                    <View style={{ flex: 1, paddingRight: Spacing.md }}>
                      <Text style={[Typography.bodyStrong, styles.quantifyTitle, { color: colors.text }]}>
                        {subLabel.enableTitle}
                      </Text>
                      <Text style={[Typography.caption, styles.quantifyHint, { color: colors.textSecondary }]}>
                        {subLabel.enableHint}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setSubHabitsEnabled((v) => !v)}
                      style={[
                        styles.switchTrack,
                        {
                          backgroundColor: subHabitsEnabled ? colors.successSwitch : colors.capsule,
                        },
                      ]}>
                      <View style={[styles.switchDot, subHabitsEnabled && styles.switchDotOn]} />
                    </Pressable>
                  </View>

                  {subHabitsEnabled ? (
                    <View style={[styles.quantifyBody, { borderTopColor: colors.outline, gap: Spacing.md }]}>
                      {subHabits.length === 0 ? (
                        <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                          {subLabel.emptyHint}
                        </Text>
                      ) : (
                        subHabits.map((item, index) => (
                          <View
                            key={item.id}
                            style={[
                              styles.subHabitRow,
                              {
                                backgroundColor: colors.surfaceSubtle,
                                borderColor: colors.outline,
                              },
                            ]}>
                            <Text style={[Typography.caption, styles.subHabitIndex, { color: colors.textMuted }]}>
                              {index + 1}
                            </Text>
                            <Pressable
                              onPress={() =>
                                setSubHabitEditor({ visible: true, editingId: item.id, name: item.name })
                              }
                              style={styles.subHabitNamePress}>
                              <Text style={[Typography.bodyStrong, { color: colors.text }]} numberOfLines={2}>
                                {item.name}
                              </Text>
                            </Pressable>
                            <View style={styles.subHabitActions}>
                              <Pressable
                                onPress={() => {
                                  if (index <= 0) return;
                                  setSubHabits((prev) => {
                                    const next = [...prev];
                                    const tmp = next[index - 1];
                                    next[index - 1] = next[index];
                                    next[index] = tmp;
                                    return next.map((it, i) => ({ ...it, sortOrder: i }));
                                  });
                                }}
                                hitSlop={8}
                                style={({ pressed }) => [{ opacity: index <= 0 ? 0.28 : pressed ? 0.65 : 1 }]}>
                                <MaterialIcons name="arrow-upward" size={18} color={colors.textSecondary} />
                              </Pressable>
                              <Pressable
                                onPress={() => {
                                  if (index >= subHabits.length - 1) return;
                                  setSubHabits((prev) => {
                                    const next = [...prev];
                                    const tmp = next[index + 1];
                                    next[index + 1] = next[index];
                                    next[index] = tmp;
                                    return next.map((it, i) => ({ ...it, sortOrder: i }));
                                  });
                                }}
                                hitSlop={8}
                                style={({ pressed }) => [
                                  { opacity: index >= subHabits.length - 1 ? 0.28 : pressed ? 0.65 : 1 },
                                ]}>
                                <MaterialIcons name="arrow-downward" size={18} color={colors.textSecondary} />
                              </Pressable>
                              <Pressable
                                onPress={() => {
                                  Alert.alert(`删除${subLabel.singular}`, `确定删除「${item.name}」？`, [
                                    { text: '取消', style: 'cancel' },
                                    {
                                      text: '删除',
                                      style: 'destructive',
                                      onPress: () =>
                                        setSubHabits((prev) =>
                                          prev
                                            .filter((it) => it.id !== item.id)
                                            .map((it, i) => ({ ...it, sortOrder: i })),
                                        ),
                                    },
                                  ]);
                                }}
                                hitSlop={8}
                                style={({ pressed }) => [{ opacity: pressed ? 0.65 : 1 }]}>
                                <MaterialIcons name="delete-outline" size={18} color={colors.danger ?? '#dc2626'} />
                              </Pressable>
                            </View>
                          </View>
                        ))
                      )}
                      <Pressable
                        onPress={() => setSubHabitEditor({ visible: true, editingId: null, name: '' })}
                        style={({ pressed }) => [
                          styles.subHabitAddBtn,
                          { borderColor: colors.outline, opacity: pressed ? 0.85 : 1 },
                        ]}>
                        <MaterialIcons name="add" size={18} color={colors.primary} />
                        <Text style={[Typography.bodyStrong, { color: colors.primary, fontSize: 14 }]}>
                          {subLabel.addButton}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
            </AppCard>
          ) : null}

          {habitKind === 'build' && activeTile === 'expected' ? (
                <AppCard variant="default" padded style={styles.sectionCardInner}>
                  <Text style={[Typography.bodyStrong, styles.numberLabel, { color: colors.text }]}>达成条件</Text>
                  <Text style={[Typography.caption, styles.expectedGoalHint, { color: colors.textSecondary }]}>
                    选择用累计天数、累计次数或连续天数作为完成依据
                  </Text>
                  <View style={styles.expectedGoalTabs}>
                    {BUILD_EXPECTED_CONDITION_TABS.map((tab) => {
                      const active = expectedGoalTab === tab.key;
                      return (
                        <Pressable
                          key={tab.key}
                          onPress={() => {
                            setExpectedGoalTab(tab.key);
                            if (tab.key === 'none') return;
                            const max = tab.key === 'times' ? 9999 : 999;
                            setExpectedGoalValue((v) => Math.min(max, Math.max(1, v)));
                          }}
                          style={[
                            styles.expectedGoalTab,
                            active
                              ? { backgroundColor: colors.primary, borderColor: colors.primary }
                              : { backgroundColor: colors.surface, borderColor: colors.outline },
                          ]}>
                          <Text
                            style={[
                              Typography.bodyStrong,
                              styles.expectedGoalTabText,
                              { color: active ? colors.onPrimary : colors.textSecondary },
                            ]}>
                            {tab.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {expectedGoalTab !== 'none' &&
                  (expectedGoalTab === 'days' ||
                    expectedGoalTab === 'times' ||
                    expectedGoalTab === 'consecutive_days') ? (
                    <NumberControl
                      label={
                        expectedGoalTab === 'times'
                          ? '目标次数'
                          : expectedGoalTab === 'consecutive_days'
                            ? '连续天数'
                            : '累计天数'
                      }
                      value={expectedGoalValue}
                      onMinus={() => setExpectedGoalValue((v) => Math.max(1, v - 1))}
                      onPlus={() => setExpectedGoalValue((v) => Math.min(buildGoalMaxValue, v + 1))}
                      textColor={colors.text}
                      mutedColor={colors.textSecondary}
                    />
                  ) : null}
                </AppCard>
          ) : null}

          {activeTile === 'reminder' ? (
              <AppCard variant="default" padded={false} style={styles.sectionCardInner}>
                <View style={styles.quantifyTop}>
                  <View style={styles.reminderIntro}>
                    <Text style={[Typography.bodyStrong, styles.quantifyTitle, { color: colors.text }]}>
                      打卡提醒
                    </Text>
                    <Text style={[Typography.caption, styles.quantifyHint, { color: colors.textSecondary }]}>
                      开启后按设定时刻推送提醒；习惯按循环规则以全天形式出现在日程表（与提醒开关无关）
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

                {schedulePlacementHint ? (
                  <Text
                    style={[
                      Typography.caption,
                      {
                        color: colors.textSecondary,
                        paddingHorizontal: Spacing.md,
                        paddingBottom: Spacing.sm,
                      },
                    ]}>
                    {schedulePlacementHint}
                  </Text>
                ) : null}

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
                      <Text style={[Typography.bodyStrong, styles.numberLabel, { color: colors.text }]}>
                        提醒时间
                      </Text>
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

          {activeTile === 'cycle' && habitKind !== 'break' ? (
              <AppCard variant="muted" padded={false} style={styles.cycleSectionOuter}>
                <View style={[styles.tabWrap, { backgroundColor: colors.capsule }]}>
                  {(habitKind === 'task' ? TASK_CYCLE_TABS : CYCLE_TABS).map((tab) => {
                    const active = tab === activeTab;
                    return (
                      <Pressable
                        key={tab}
                        onPress={() => setActiveTab(tab as CycleTab & TaskRepeatPeriod)}
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
                  {habitKind === 'task' ? (
                    <Text style={[Typography.body, styles.cycleHintText, { color: colors.textSecondary }]}>
                      在
                      <Text style={[Typography.h3, styles.cycleHintStrong, { color: colors.text }]}>
                        {' '}
                        {(TASK_CYCLE_TABS as string[]).includes(activeTab) ? activeTab : DEFAULT_TASK_REPEAT_PERIOD}
                        {' '}
                      </Text>
                      周期内完成预期目标后，本周期内不再展示
                    </Text>
                  ) : null}

                  {habitKind !== 'task' && activeTab === '每天' ? (
                    <Text style={[Typography.body, styles.cycleHintText, { color: colors.textSecondary }]}>
                      每天都可打卡，全年无休
                    </Text>
                  ) : null}

                  {habitKind !== 'task' && activeTab === '每周定期' ? (
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

                  {habitKind !== 'task' && activeTab === '每周N天' ? (
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

                  {habitKind !== 'task' && activeTab === '每月定期' ? (
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

                  {habitKind !== 'task' && activeTab === '每月N天' ? (
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

          {/* —— 只读规则摘要 —— */}
          <HabitCard style={[styles.summaryCard, { backgroundColor: isDark ? tf.card : 'rgba(245,241,231,0.92)' }]}>
            <HabitSect title="当前类型会怎样计算" count="只读摘要" />
            <View style={styles.sumGrid}>
              {HBT_SUM[habitKind].cells.map((c) => (
                <View
                  key={c.b}
                  style={[styles.sumCell, { backgroundColor: isDark ? tf.paper2 : '#F4F0E6' }]}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: tf.ink2 }} numberOfLines={1}>
                    {c.b}
                  </Text>
                  <Text style={{ fontSize: 10, color: tf.faint, marginTop: 2 }} numberOfLines={1}>
                    {c.s}
                  </Text>
                </View>
              ))}
            </View>
            <View style={styles.sumBadgeRow}>
              <Text style={[styles.sumBadge, { backgroundColor: isDark ? tf.paper2 : '#F1EDE1', color: tf.muted }]}>
                {HBT_SUM[habitKind].title}
              </Text>
            </View>
          </HabitCard>
          <Text style={[styles.footnote, { color: tf.faint }]}>
            草稿实时写本机 · 保存失败只提示「仅本机」
          </Text>
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
        {isEditMode ? (
          <AppButton
            variant="danger"
            size="lg"
            fullWidth
            label="删除习惯"
            loading={deleting}
            disabled={deleting}
            onPress={handleDelete}
          />
        ) : (
          <AppButton
            variant="primary"
            size="lg"
            fullWidth
            label={saving ? '创建中…' : '创建习惯'}
            loading={saving}
            disabled={deleting || saving}
            onPress={() => void handleSave()}
          />
        )}
      </View>

      <Modal
        visible={numberEditor.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setNumberEditor((prev) => ({ ...prev, visible: false }))}>
        <View style={styles.iconModalRoot}>
          <Pressable style={[styles.iconModalBackdrop, { backgroundColor: colors.overlay }]} onPress={() => setNumberEditor((prev) => ({ ...prev, visible: false }))} />
          <View style={[styles.iconModalCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}> 
            <Text style={[Typography.title, styles.iconModalTitle, { color: colors.text }]}>{numberEditor.label}</Text>
            <TextInput
              autoFocus
              value={numberEditor.value}
              onChangeText={(value) => setNumberEditor((prev) => ({ ...prev, value: value.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              style={[styles.subHabitEditorInput, Typography.body, { color: colors.text, backgroundColor: colors.surfaceSubtle, borderColor: colors.outline }]}
            />
            <AppButton variant="primary" size="md" label="确定" onPress={() => {
              const value = Number(numberEditor.value);
              if (!Number.isInteger(value) || value < numberEditor.min || value > numberEditor.max) {
                Alert.alert('输入无效', `请输入 ${numberEditor.min}～${numberEditor.max} 的整数`);
                return;
              }
              numberEditor.onSave(value);
              setNumberEditor((prev) => ({ ...prev, visible: false }));
            }} />
          </View>
        </View>
      </Modal>

      <Modal
        visible={subHabitEditor.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setSubHabitEditor({ visible: false, editingId: null, name: '' })}>
        <View style={styles.iconModalRoot}>
          <Pressable
            style={[styles.iconModalBackdrop, { backgroundColor: colors.overlay }]}
            onPress={() => setSubHabitEditor({ visible: false, editingId: null, name: '' })}
          />
          <View style={[styles.iconModalCard, { backgroundColor: colors.surface, borderColor: colors.outline }]}>
            <Text style={[Typography.title, styles.iconModalTitle, { color: colors.text }]}>
              {habitSubItemsLabel(habitKind).editorTitle(!!subHabitEditor.editingId)}
            </Text>
            <TextInput
              value={subHabitEditor.name}
              onChangeText={(name) => setSubHabitEditor((prev) => ({ ...prev, name }))}
              placeholder={
                habitKind === 'task'
                  ? '例如：写大纲、改一稿'
                  : habitKind === 'break'
                    ? '例如：不抽烟、不晚睡刷手机'
                    : '例如：叠被子、喝一杯水'
              }
              placeholderTextColor={colors.textMuted}
              autoFocus
              style={[
                styles.subHabitEditorInput,
                Typography.body,
                {
                  color: colors.text,
                  backgroundColor: colors.surfaceSubtle,
                  borderColor: colors.outline,
                },
              ]}
            />
            <View style={styles.subHabitEditorActions}>
              <Pressable
                onPress={() => setSubHabitEditor({ visible: false, editingId: null, name: '' })}
                style={({ pressed }) => [
                  styles.subHabitEditorBtnGhost,
                  { borderColor: colors.outline, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[Typography.bodyStrong, { color: colors.textSecondary }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const name = subHabitEditor.name.trim();
                  if (!name) {
                    Alert.alert('提示', '请输入子习惯名称');
                    return;
                  }
                  setSubHabits((prev) => {
                    if (subHabitEditor.editingId) {
                      return prev.map((it) =>
                        it.id === subHabitEditor.editingId ? { ...it, name } : it,
                      );
                    }
                    return [
                      ...prev,
                      { id: createHabitSubItemId(), name, sortOrder: prev.length },
                    ];
                  });
                  setSubHabitEditor({ visible: false, editingId: null, name: '' });
                }}
                style={({ pressed }) => [
                  styles.subHabitEditorBtnPrimary,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                ]}>
                <Text style={[Typography.bodyStrong, { color: colors.onPrimary }]}>
                  {subHabitEditor.editingId ? '保存' : '添加'}
                </Text>
              </Pressable>
            </View>
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
  appbar: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconbtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 15, fontWeight: '700' },
  appbarSub: { fontSize: 10, marginTop: 2 },
  pillbtn: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 13,
    paddingTop: 6,
    gap: 0,
  },
  headerActionText: { fontSize: 15 },
  main: { gap: 4, maxWidth: Layout.contentMaxWidth, alignSelf: 'center', width: '100%' },
  identityCard: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hbtIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
  },
  idMain: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  hbtName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
    padding: 0,
    margin: 0,
    minHeight: 24,
  },
  hbtMeta: { fontSize: 10, marginTop: 4, letterSpacing: 0.3 },
  requiredBadge: {
    fontSize: 10,
    color: '#9A6A30',
    backgroundColor: '#F8ECD7',
    borderWidth: 1,
    borderColor: '#EBD3AB',
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    marginTop: 2,
    overflow: 'hidden',
  },
  descRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  descInput: { flex: 1, fontSize: 13, padding: 0, minWidth: 0 },
  tagsRow: { marginTop: 6 },
  typeRow: { flexDirection: 'row', gap: 5 },
  typeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  typeDot: { width: 6, height: 6, borderRadius: 3 },
  typeNoteText: { flex: 1, fontSize: 11, fontWeight: '600' },
  scoreCard: { paddingBottom: 8 },
  scoreMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  scoreNum: { flexDirection: 'row', alignItems: 'baseline', gap: 2 },
  scoreStep: { gap: 3 },
  scoreStepBtn: {
    width: 20,
    height: 16,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: '#DCE2D2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakGrid: { flexDirection: 'row', gap: 5 },
  breakCell: {
    flex: 1,
    backgroundColor: '#F8EDE8',
    borderWidth: 1,
    borderColor: '#EED8CF',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  breakCellLabel: { fontSize: 10, color: '#A08377' },
  breakCellInput: { fontSize: 15, fontWeight: '700', padding: 0, marginTop: 2 },
  breakNote: { fontSize: 10, marginTop: 6, paddingHorizontal: 2 },
  previewGrid: { flexDirection: 'row', gap: 4, marginTop: 6 },
  previewCell: {
    flex: 1,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignItems: 'center',
  },
  previewIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  optDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginVertical: 6,
    paddingHorizontal: 2,
  },
  optLine: { flex: 1, height: StyleSheet.hairlineWidth },
  optLabel: { fontSize: 11, fontWeight: '600' },
  toneChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  toneChip: {
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toneChipAdd: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hbtHint: { fontSize: 10, marginTop: 6, lineHeight: 14 },
  switchForced: { shadowColor: '#C47055', shadowOpacity: 0.18, shadowRadius: 2, elevation: 1 },
  tilesCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 7,
    marginBottom: 4,
  },
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  summaryCard: { paddingHorizontal: 10, paddingVertical: 8 },
  sumGrid: { flexDirection: 'row', gap: 4 },
  sumCell: { flex: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 5 },
  sumBadgeRow: { marginTop: 6, flexDirection: 'row' },
  sumBadge: {
    fontSize: 10,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  footnote: {
    textAlign: 'center',
    fontSize: 10,
    paddingVertical: 4,
    marginBottom: 4,
  },
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
    ...StyleSheet.absoluteFill,
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
  rewardPointsWrap: {
    minHeight: 40,
    paddingVertical: Spacing.md,
  },
  kindBlock: { gap: Spacing.md },
  breakRewardsBlock: { gap: Spacing.md },
  breakRewardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  breakRewardField: { flex: 1, minWidth: 0, gap: Spacing.xs },
  breakRewardFieldLabel: { fontSize: 11, fontWeight: '600', paddingLeft: 2 },
  breakRewardFieldInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 1,
    fontSize: 14,
    textAlign: 'center',
    minWidth: 0,
  },
  breakRewardsHint: { lineHeight: 16, paddingHorizontal: 2 },
  kindBlockLabel: { paddingLeft: Spacing.xs },
  pointGridCard: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: Spacing.sm,
  },
  pointGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pointCell: {
    width: '48%',
    flexGrow: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  kindCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    borderRadius: 10,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.md,
    alignItems: 'flex-start',
    gap: 2,
    minHeight: 52,
  },
  kindCardEmoji: { fontSize: 22 },
  kindCardTitle: { fontSize: 13, fontWeight: '700' },
  kindCardSub: { textAlign: 'left', lineHeight: 14, fontSize: 10 },
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
  breakCycleFixedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  breakCycleFixedTextWrap: { flex: 1, minWidth: 0, gap: 2 },
  breakCycleFixedTitle: { fontSize: 14 },
  breakCycleFixedHint: { lineHeight: 17 },
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
  quantifyBreakHint: { marginTop: -4, marginBottom: 8, paddingHorizontal: 2 },
  expectedGoalBlock: { marginTop: Spacing.sm, paddingTop: Spacing.md, gap: Spacing.sm },
  expectedGoalHint: { paddingHorizontal: 2, lineHeight: 18 },
  expectedGoalTabs: { flexDirection: 'row', gap: Spacing.md },
  expectedGoalTab: {
    flex: 1,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  expectedGoalTabText: { fontSize: 13 },
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
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  tabItem: {
    flexGrow: 1,
    flexBasis: '31%',
    minWidth: 72,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
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
  subHabitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  subHabitIndex: { width: 18, textAlign: 'center', fontWeight: '700' },
  subHabitNamePress: { flex: 1, minWidth: 0 },
  subHabitActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  subHabitAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: Radius.md,
    paddingVertical: Spacing.lg,
  },
  subHabitEditorInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 15,
  },
  subHabitEditorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.md,
    marginTop: Spacing.lg,
  },
  subHabitEditorBtnGhost: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  subHabitEditorBtnPrimary: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
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
