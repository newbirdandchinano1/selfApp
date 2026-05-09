import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME } from '@/lib/repositories/projects/constants';
import {
  createProjectCategory,
  deleteProjectCategory,
  getProjectCategories,
  getProjects,
  updateProjectCategory,
} from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import {
  getTasks,
  getTasksByProjectId,
  type TaskTreeNode,
  updateTask,
} from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { playHabitCheckInDing } from '@/lib/play-habit-check-in-ding';
import {
  decrementTodayHabitCheckIn,
  getHabitCheckInListStats,
  incrementTodayHabitCheckIn,
} from '@/lib/repositories/habits/habit-check-in';
import { getHabits } from '@/lib/repositories/habits/habit';
import { getHabitContexts } from '@/lib/repositories/habits/habit-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Alert,
  Animated,
  Easing,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Dimensions,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PROJECT_EXPANDED_STORAGE_KEY = '@tasks_project_expanded_v1';

/** Tasks「小习惯」网格：固定每行列数，单元宽度按行宽均分 */
const HABIT_GRID_GAP = 16;
const HABIT_GRID_COLUMNS = 4;

function PulseDot({ color }: { color: string }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(0.45)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 2.4, duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.45, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color, transform: [{ scale }], opacity }]} />
      <View style={[styles.pulseCenter, { backgroundColor: color }]} />
    </View>
  );
}

function EmptyPlaceholder({
  icon,
  title,
  subtitle,
  color,
  muted,
  cardBg,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle?: string;
  color: string;
  muted: string;
  cardBg: string;
}) {
  return (
    <View style={[styles.emptyWrap, { backgroundColor: cardBg, borderColor: `${muted}22` }]}>
      <View style={[styles.emptyIcon, { backgroundColor: `${color}14` }]}>
        <MaterialIcons name={icon} size={26} color={color} />
      </View>
      <Text style={[styles.emptyTitle, { color: muted }]}>{title}</Text>
      {!!subtitle && (
        <Text style={[styles.emptySubtitle, { color: muted }]} numberOfLines={2}>
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function SegmentTabs({
  tabs,
  active,
  onChange,
  color,
  muted,
  onLongPressTab,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
  color: string;
  muted: string;
  onLongPressTab?: (key: string, label: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.segmentRow}
      keyboardShouldPersistTaps="handled">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            onLongPress={() => onLongPressTab?.(tab.key, tab.label)}
            delayLongPress={260}
            style={styles.segmentBtn}>
            <Text
              style={[
                styles.segmentText,
                {
                  color: isActive ? color : muted,
                  borderBottomColor: isActive ? color : 'transparent',
                  fontWeight: isActive ? '800' : '600',
                },
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ScalePressable({
  children,
  scaleTo = 0.97,
  style,
  animatedStyle,
  onPressIn,
  onPressOut,
  ...rest
}: React.ComponentProps<typeof Pressable> & {
  children: React.ReactNode;
  scaleTo?: number;
  animatedStyle?: any;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = React.useCallback(
    (event: any) => {
      Animated.spring(scale, {
        toValue: scaleTo,
        speed: 30,
        bounciness: 4,
        useNativeDriver: true,
      }).start();
      onPressIn?.(event);
    },
    [onPressIn, scale, scaleTo]
  );

  const handlePressOut = React.useCallback(
    (event: any) => {
      Animated.spring(scale, {
        toValue: 1,
        speed: 24,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
      onPressOut?.(event);
    },
    [onPressOut, scale]
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, animatedStyle]}>
      <Pressable {...rest} style={style} onPressIn={handlePressIn} onPressOut={handlePressOut}>
        {children}
      </Pressable>
    </Animated.View>
  );
}

type ProjectScheduleMeta = {
  mode?: 'date' | 'time';
  reminderOption?: string;
  repeatOption?: string;
  range?: { start: string; end: string };
};

type TaskMetaExtra = {
  reminder?: string;
  repeat?: string;
  frogAssignedOn?: string;
};

type HabitSection = {
  id: string;
  title: string;
  items: Array<{
    id: string;
    icon: string;
    name: string;
    todayCount: number;
    /** `extra_data.quantify.dailyGoal`，null 表示不限 */
    dailyGoalMax: number | null;
  }>;
};

function parseHabitDailyGoalMax(extraData: string | null): number | null {
  if (!extraData) return null;
  try {
    const p = JSON.parse(extraData) as { quantify?: { dailyGoal?: number | null } };
    const g = p?.quantify?.dailyGoal;
    if (g === null || g === undefined) return null;
    if (typeof g === 'number' && Number.isFinite(g) && g > 0) return Math.min(99, Math.max(1, Math.round(g)));
    return null;
  } catch {
    return null;
  }
}

function parseProjectSchedule(extraData: string | null): ProjectScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: ProjectScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

function parseTaskMeta(extraData: string | null): TaskMetaExtra {
  if (!extraData) return {};
  try {
    const parsed = JSON.parse(extraData) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TaskMetaExtra;
    }
    return {};
  } catch {
    return {};
  }
}

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTaskPriority(priority: number): string {
  if (priority >= 4) return '紧急重要';
  if (priority === 3) return '紧急不重要';
  if (priority === 2) return '不紧急重要';
  if (priority === 1) return '不紧急不重要';
  return '';
}

function getTaskPriorityColor(priority: number, isDark: boolean) {
  if (priority >= 4) return isDark ? '#f87171' : '#ba1a1a';
  if (priority === 3) return isDark ? '#fbbf24' : '#9a5b00';
  if (priority === 2) return isDark ? '#60a5fa' : '#0058be';
  if (priority === 1) return isDark ? '#94a3b8' : '#727785';
  return isDark ? '#94a3b8' : '#727785';
}

function sortTaskTree(nodes: TaskTreeNode[]): TaskTreeNode[] {
  const safeTime = (value: string | null | undefined) => {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  };
  const safeDate = (value: string | null | undefined) => {
    if (!value) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };

  const clone = nodes.map((n) => ({
    ...n,
    children: sortTaskTree(n.children ?? []),
  }));

  clone.sort((a, b) => {
    const doneA = a.status === 'done' || a.status === 'cancelled';
    const doneB = b.status === 'done' || b.status === 'cancelled';
    if (doneA !== doneB) return doneA ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const dueA = safeDate(a.due_date);
    const dueB = safeDate(b.due_date);
    if (dueA !== dueB) return dueA - dueB;
    const updA = safeTime(a.updated_at);
    const updB = safeTime(b.updated_at);
    return updB - updA;
  });

  return clone;
}

function formatScheduleDateToYMD(value: string) {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ymdToLocalDate(ymd: string): Date | null {
  const t = ymd.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

function formatYmdCN(ymd: string): string {
  const t = ymd.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return t;
  const year = m[1];
  const month = String(Number(m[2]));
  const day = String(Number(m[3]));
  return `${year}年${month}月${day}日`;
}

function formatProjectDueText(dueYmd: string): string {
  const todayYmd = formatLocalYmd(new Date());
  const due = ymdToLocalDate(dueYmd);
  const today = ymdToLocalDate(todayYmd);
  if (!due || !today) return `截止：${formatYmdCN(dueYmd)}`;
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return '截至今日';
  if (diffDays === 1) return '截至明日';
  if (diffDays === 2) return '截至后天';
  return `截止：${formatYmdCN(dueYmd)}`;
}

function formatTaskDueText(dueYmd: string): string {
  const todayYmd = formatLocalYmd(new Date());
  const due = ymdToLocalDate(dueYmd);
  const today = ymdToLocalDate(todayYmd);
  if (!due || !today) return `截止：${dueYmd}`;
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return '截至今日';
  if (diffDays === 1) return '截至明日';
  if (diffDays === 2) return '截至后天';
  return `截止：${dueYmd}`;
}

function getProjectScheduleLabel(project: ProjectRow, schedule: ProjectScheduleMeta | null) {
  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const start = formatScheduleDateToYMD(schedule.range.start);
    const end = formatScheduleDateToYMD(schedule.range.end);
    return `${start} ~ ${end}`;
  }
  return project.due_date ? formatScheduleDateToYMD(project.due_date) : null;
}

export default function TasksScreen() {
  /** Measured width of the habit grid row — avoids guessing padding (tabs / safe area / web max-width). */
  const [habitItemsRowWidth, setHabitItemsRowWidth] = React.useState(0);
  const habitGridItemWidth = React.useMemo(() => {
    const gap = HABIT_GRID_GAP;
    const cols = HABIT_GRID_COLUMNS;
    const rowWidth =
      habitItemsRowWidth > 1
        ? habitItemsRowWidth
        : Math.max(120, Dimensions.get('window').width - 18 * 2 - 14 * 2);
    return (rowWidth - gap * (cols - 1)) / cols;
  }, [habitItemsRowWidth]);

  const onHabitItemsRowLayout = React.useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    const w = e.nativeEvent.layout.width;
    setHabitItemsRowWidth((prev) => (Math.abs(prev - w) < 0.5 ? prev : w));
  }, []);

  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as keyof typeof Colors;
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';
  const TASK_INDENT = 18;

  const [taskTab, setTaskTab] = React.useState<string>('all');
  const [projectTab, setProjectTab] = React.useState<string>('all');
  const [projects, setProjects] = React.useState<ProjectRow[]>([]);
  const [projectCategories, setProjectCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [tasks, setTasks] = React.useState<TaskRow[]>([]);
  const [projectTaskTreeMap, setProjectTaskTreeMap] = React.useState<Record<string, TaskTreeNode[]>>({});
  const [expandedProjectIds, setExpandedProjectIds] = React.useState<Record<string, boolean>>({});
  const [collapsedTaskIds, setCollapsedTaskIds] = React.useState<Record<string, boolean>>({});
  const [categoryModalVisible, setCategoryModalVisible] = React.useState(false);
  const [categoryEditorVisible, setCategoryEditorVisible] = React.useState(false);
  const [categoryEditorTitle, setCategoryEditorTitle] = React.useState('新建分类');
  const [categoryInputValue, setCategoryInputValue] = React.useState('');
  const [activeCategoryLabel, setActiveCategoryLabel] = React.useState('全部');
  const [activeCategoryId, setActiveCategoryId] = React.useState<string | null>(null);
  const [habitSections, setHabitSections] = React.useState<HabitSection[]>([]);
  const [expandedHabitSections, setExpandedHabitSections] = React.useState<Record<string, boolean>>({});

  const pageFadeAnim = React.useRef(new Animated.Value(0)).current;
  const pageTranslateAnim = React.useRef(new Animated.Value(18)).current;
  const frogCardAnim = React.useRef(new Animated.Value(0)).current;
  const matrixAnim = React.useRef(new Animated.Value(0)).current;
  const projectAnim = React.useRef(new Animated.Value(0)).current;
  const bgFloatAnim = React.useRef(new Animated.Value(0)).current;
  const frogDoneBounceMap = React.useRef<Record<string, Animated.Value>>({});

  const loadProjects = React.useCallback(async () => {
    try {
      const rows = await getProjects();
      setProjects(rows);
      return rows;
    } catch (err) {
      console.warn('加载项目列表失败', err);
      setProjects([]);
      return [];
    }
  }, []);

  const loadExpandedProjectState = React.useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(PROJECT_EXPANDED_STORAGE_KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const map: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof k !== 'string') continue;
        if (typeof v !== 'boolean') continue;
        map[k] = v;
      }
      return map;
    } catch (err) {
      console.warn('读取项目展开状态失败', err);
      return null;
    }
  }, []);

  const saveExpandedProjectState = React.useCallback(async (next: Record<string, boolean>) => {
    try {
      await AsyncStorage.setItem(PROJECT_EXPANDED_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('保存项目展开状态失败', err);
    }
  }, []);

  const loadProjectCategories = React.useCallback(async () => {
    try {
      const rows = await getProjectCategories();
      setProjectCategories(rows);
    } catch (err) {
      console.warn('加载项目分类失败', err);
      setProjectCategories([]);
    }
  }, []);

  const loadTasks = React.useCallback(async () => {
    try {
      const rows = await getTasks();
      setTasks(rows);
    } catch (err) {
      console.warn('加载任务列表失败', err);
      setTasks([]);
    }
  }, []);

  const loadHabits = React.useCallback(async () => {
    try {
      const [contexts, rows, checkStats] = await Promise.all([
        getHabitContexts(),
        getHabits(),
        getHabitCheckInListStats(),
      ]);
      const itemsByContext = new Map<string, HabitSection['items']>();

      for (const r of rows) {
        const arr = itemsByContext.get(r.context) ?? [];
        const todayCount = checkStats.get(r.id)?.todayCount ?? 0;
        const dailyGoalMax = parseHabitDailyGoalMax(r.extra_data);
        arr.push({ id: r.id, icon: r.icon, name: r.name, todayCount, dailyGoalMax });
        itemsByContext.set(r.context, arr);
      }

      const ordered = contexts.map((c) => c.name);
      const known = new Set(ordered);
      const legacy = Array.from(itemsByContext.keys())
        .filter((ctx) => !known.has(ctx))
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      const all = [...ordered, ...legacy];

      const nextSections: HabitSection[] = all.map((ctx) => ({
        id: ctx,
        title: ctx,
        items: itemsByContext.get(ctx) ?? [],
      }));

      setHabitSections(nextSections);
      setExpandedHabitSections((prev) => {
        const next = { ...prev };
        for (const s of nextSections) {
          if (typeof next[s.id] !== 'boolean') next[s.id] = true;
        }
        return next;
      });
    } catch (err) {
      console.warn('加载习惯失败', err);
      setHabitSections([]);
    }
  }, []);

  const loadProjectTasks = React.useCallback(async (rows: ProjectRow[]) => {
    if (rows.length === 0) {
      setProjectTaskTreeMap({});
      return;
    }
    try {
      const entries = await Promise.all(
        rows.map(async (project) => {
          const tree = await getTasksByProjectId(project.id);
          return [project.id, tree] as const;
        })
      );
      setProjectTaskTreeMap(Object.fromEntries(entries));
    } catch (err) {
      console.warn('加载项目任务失败', err);
      setProjectTaskTreeMap({});
    }
  }, []);

  React.useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(pageFadeAnim, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pageTranslateAnim, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.stagger(90, [
        Animated.timing(frogCardAnim, {
          toValue: 1,
          duration: 440,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(matrixAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(projectAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [frogCardAnim, matrixAnim, pageFadeAnim, pageTranslateAnim, projectAnim]);

  React.useEffect(() => {
    matrixAnim.stopAnimation(() => {
      matrixAnim.setValue(0.9);
      Animated.spring(matrixAnim, {
        toValue: 1,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }).start();
    });
  }, [matrixAnim, taskTab]);

  React.useEffect(() => {
    projectAnim.stopAnimation(() => {
      projectAnim.setValue(0.9);
      Animated.spring(projectAnim, {
        toValue: 1,
        speed: 18,
        bounciness: 7,
        useNativeDriver: true,
      }).start();
    });
  }, [projectAnim, projectTab]);

  React.useEffect(() => {
    frogCardAnim.stopAnimation(() => {
      frogCardAnim.setValue(0.92);
      Animated.spring(frogCardAnim, {
        toValue: 1,
        speed: 20,
        bounciness: 8,
        useNativeDriver: true,
      }).start();
    });
  }, [frogCardAnim, tasks]);

  React.useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bgFloatAnim, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgFloatAnim, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [bgFloatAnim]);

  React.useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadExpandedProjectState();
      if (cancelled) return;
      if (stored) {
        setExpandedProjectIds(stored);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadExpandedProjectState]);

  React.useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  React.useEffect(() => {
    loadProjectTasks(projects);
  }, [loadProjectTasks, projects]);

  React.useEffect(() => {
    loadProjectCategories();
  }, [loadProjectCategories]);

  React.useEffect(() => {
    if (!categoryModalVisible) return;
    loadProjectCategories();
  }, [categoryModalVisible, loadProjectCategories]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      (async () => {
        const storedExpanded = await loadExpandedProjectState();
        const rows = await loadProjects();
        if (cancelled) return;
        // 首次无存储记录：默认全部展开；有记录则按记录恢复（新项目默认展开）。
        if (!storedExpanded) {
          const allExpanded = Object.fromEntries(rows.map((p) => [p.id, true] as const));
          setExpandedProjectIds(allExpanded);
          await saveExpandedProjectState(allExpanded);
        } else {
          const merged: Record<string, boolean> = { ...storedExpanded };
          for (const p of rows) {
            if (typeof merged[p.id] !== 'boolean') merged[p.id] = true;
          }
          setExpandedProjectIds(merged);
          await saveExpandedProjectState(merged);
        }
        await loadProjectTasks(rows);
        await loadProjectCategories();
        await loadTasks();
        await loadHabits();
      })();
      return () => {
        cancelled = true;
      };
    }, [loadExpandedProjectState, loadProjectCategories, loadProjects, loadProjectTasks, loadTasks, loadHabits, saveExpandedProjectState])
  );

  const taskTitleById = React.useMemo(() => {
    const map = new Map<string, string>();
    tasks.forEach((t) => map.set(t.id, t.title));
    return map;
  }, [tasks]);

  const filteredTasks = React.useMemo(() => {
    if (taskTab === 'all') return tasks;
    if (taskTab === INBOX_PROJECT_CATEGORY_ID) {
      return tasks.filter((t) => !t.category_id || t.category_id === INBOX_PROJECT_CATEGORY_ID);
    }
    return tasks.filter((t) => t.category_id === taskTab);
  }, [taskTab, tasks]);

  const todayFrogs = React.useMemo(() => {
    const today = formatLocalYmd(new Date());
    return tasks
      .filter((t) => {
        const meta = parseTaskMeta(t.extra_data);
        return (meta.frogAssignedOn ?? '') === today;
      })
      .slice()
      .sort((a, b) => {
        const doneA = a.status === 'done' || a.status === 'cancelled';
        const doneB = b.status === 'done' || b.status === 'cancelled';
        if (doneA !== doneB) return doneA ? 1 : -1;
        if (a.priority !== b.priority) return b.priority - a.priority;
        const updA = a.updated_at ? Date.parse(a.updated_at) : 0;
        const updB = b.updated_at ? Date.parse(b.updated_at) : 0;
        return updB - updA;
      });
  }, [tasks]);

  const todayFrogCards = React.useMemo(() => todayFrogs.slice(0, 4), [todayFrogs]);

  const matrixGroups = React.useMemo(() => {
    const q11: TaskRow[] = []; // 紧急且重要
    const q10: TaskRow[] = []; // 不紧急但重要
    const q01: TaskRow[] = []; // 紧急但不重要
    const q00: TaskRow[] = []; // 不紧急不重要

    filteredTasks.forEach((t) => {
      if (t.priority >= 4) q11.push(t);
      else if (t.priority === 2) q10.push(t);
      else if (t.priority === 3) q01.push(t);
      else q00.push(t);
    });

    const sort = (arr: TaskRow[]) =>
      arr
        .slice()
        .sort((a, b) => {
          const doneA = a.status === 'done' || a.status === 'cancelled';
          const doneB = b.status === 'done' || b.status === 'cancelled';
          if (doneA !== doneB) return doneA ? 1 : -1;
          const dueA = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
          const dueB = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY;
          if (dueA !== dueB) return dueA - dueB;
          const updA = a.updated_at ? Date.parse(a.updated_at) : 0;
          const updB = b.updated_at ? Date.parse(b.updated_at) : 0;
          return updB - updA;
        });

    return { q11: sort(q11), q10: sort(q10), q01: sort(q01), q00: sort(q00) };
  }, [filteredTasks]);

  const projectCategoryMap = React.useMemo(() => {
    const map = new Map<string, string>();
    projectCategories.forEach((category) => {
      map.set(category.id, category.name);
    });
    return map;
  }, [projectCategories]);

  const projectTabs = React.useMemo(() => {
    const base: Array<{ key: string; label: string }> = [
      { key: 'all', label: '全部' },
      { key: INBOX_PROJECT_CATEGORY_ID, label: INBOX_PROJECT_CATEGORY_NAME },
    ];

    const extra = projectCategories
      .filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID)
      .map((c) => ({ key: c.id, label: c.name }));

    return [...base, ...extra];
  }, [projectCategories]);

  const taskTabs = React.useMemo(() => {
    const base: Array<{ key: string; label: string }> = [
      { key: 'all', label: '全部' },
      { key: INBOX_PROJECT_CATEGORY_ID, label: INBOX_PROJECT_CATEGORY_NAME },
    ];
    const extra = projectCategories
      .filter((c) => c.id !== INBOX_PROJECT_CATEGORY_ID)
      .map((c) => ({ key: c.id, label: c.name }));
    return [...base, ...extra];
  }, [projectCategories]);

  const openTask = (id: string) => {
    router.push({ pathname: '/task/[id]', params: { id } });
  };

  const openProject = (id: string) => {
    router.push({ pathname: '/edit-project', params: { id } });
  };

  const updateTaskInProjectTree = React.useCallback(
    (treeMap: Record<string, TaskTreeNode[]>, taskId: string, updater: (node: TaskTreeNode) => TaskTreeNode) => {
      const updateNodes = (nodes: TaskTreeNode[]): TaskTreeNode[] => {
        let changed = false;
        const next = nodes.map((n) => {
          if (n.id === taskId) {
            changed = true;
            return { ...updater(n), children: n.children };
          }
          if (n.children?.length) {
            const updatedChildren = updateNodes(n.children);
            if (updatedChildren !== n.children) {
              changed = true;
              return { ...n, children: updatedChildren };
            }
          }
          return n;
        });
        return changed ? next : nodes;
      };

      let anyChanged = false;
      const nextMap: Record<string, TaskTreeNode[]> = {};
      for (const [projectId, nodes] of Object.entries(treeMap)) {
        const nextNodes = updateNodes(nodes);
        if (nextNodes !== nodes) anyChanged = true;
        nextMap[projectId] = nextNodes;
      }
      return anyChanged ? nextMap : treeMap;
    },
    []
  );

  const getFrogDoneBounce = React.useCallback((taskId: string) => {
    if (!frogDoneBounceMap.current[taskId]) {
      frogDoneBounceMap.current[taskId] = new Animated.Value(1);
    }
    return frogDoneBounceMap.current[taskId];
  }, []);

  const playFrogDoneBounce = React.useCallback(
    (taskId: string) => {
      const anim = getFrogDoneBounce(taskId);
      anim.stopAnimation(() => {
        anim.setValue(1);
        Animated.sequence([
          Animated.timing(anim, {
            toValue: 1.28,
            duration: 120,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(anim, {
            toValue: 1,
            speed: 18,
            bounciness: 9,
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [getFrogDoneBounce]
  );

  const toggleTaskDone = React.useCallback(
    async (taskId: string) => {
      const current = tasks.find((t) => t.id === taskId);
      if (!current) return;

      const wasDone = current.status === 'done' || current.status === 'cancelled';
      const nextStatus: TaskRow['status'] = wasDone ? 'todo' : 'done';
      const nextCompletedAt = wasDone ? null : new Date().toISOString();

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

      // optimistic update: matrix/today frogs use `tasks`, project tree uses `projectTaskTreeMap`
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus, completed_at: nextCompletedAt } : t))
      );
      setProjectTaskTreeMap((prev) =>
        updateTaskInProjectTree(prev, taskId, (node) => ({ ...node, status: nextStatus, completed_at: nextCompletedAt }))
      );

      try {
        await updateTask(taskId, { status: nextStatus, completed_at: nextCompletedAt });
      } catch (err) {
        console.warn('更新任务状态失败', err);
        // fallback: reload to ensure consistency
        await loadTasks();
        await loadProjectTasks(projects);
      }
    },
    [loadProjectTasks, loadTasks, projects, tasks, updateTaskInProjectTree]
  );

  const openCategoryMenu = (_scope: 'task' | 'project', label: string, categoryId: string | null = null) => {
    setActiveCategoryLabel(label);
    setActiveCategoryId(categoryId);
    setCategoryInputValue(label);
    setCategoryModalVisible(true);
  };

  const toggleProjectExpand = React.useCallback(
    (projectId: string) => {
      setExpandedProjectIds((prev) => {
        const next = { ...prev, [projectId]: !prev[projectId] };
        void saveExpandedProjectState(next);
        return next;
      });
    },
    [saveExpandedProjectState]
  );

  const toggleTaskCollapse = React.useCallback((taskId: string) => {
    setCollapsedTaskIds((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  }, []);

  const toggleHabitSection = React.useCallback((sectionId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedHabitSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  const habitIconTapTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const habitIconTapFirstRef = React.useRef<{ habitId: string; t: number } | null>(null);

  React.useEffect(() => {
    return () => {
      if (habitIconTapTimerRef.current) clearTimeout(habitIconTapTimerRef.current);
    };
  }, []);

  const patchHabitTodayCount = React.useCallback((habitId: string, todayCount: number) => {
    setHabitSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.id === habitId ? { ...it, todayCount } : it)),
      }))
    );
  }, []);

  const handleHabitIncrement = React.useCallback(
    async (habitId: string, dailyGoalMax: number | null) => {
      try {
        const { nextCount, increased } = await incrementTodayHabitCheckIn(habitId, dailyGoalMax);
        patchHabitTodayCount(habitId, nextCount);
        if (increased) void playHabitCheckInDing();
      } catch (err) {
        console.warn('习惯打卡失败', err);
      }
    },
    [patchHabitTodayCount]
  );

  const handleHabitUndoOnce = React.useCallback(
    async (habitId: string) => {
      try {
        const nextCount = await decrementTodayHabitCheckIn(habitId);
        patchHabitTodayCount(habitId, nextCount);
      } catch (err) {
        console.warn('撤销打卡失败', err);
      }
    },
    [patchHabitTodayCount]
  );

  const handleHabitIconPress = React.useCallback(
    (item: { id: string; dailyGoalMax: number | null }) => {
      const DOUBLE_MS = 300;
      const now = Date.now();
      const first = habitIconTapFirstRef.current;
      if (first && first.habitId === item.id && now - first.t < DOUBLE_MS) {
        habitIconTapFirstRef.current = null;
        if (habitIconTapTimerRef.current) {
          clearTimeout(habitIconTapTimerRef.current);
          habitIconTapTimerRef.current = null;
        }
        void handleHabitUndoOnce(item.id);
        return;
      }
      habitIconTapFirstRef.current = { habitId: item.id, t: now };
      if (habitIconTapTimerRef.current) clearTimeout(habitIconTapTimerRef.current);
      habitIconTapTimerRef.current = setTimeout(() => {
        habitIconTapTimerRef.current = null;
        habitIconTapFirstRef.current = null;
        void handleHabitIncrement(item.id, item.dailyGoalMax);
      }, DOUBLE_MS);
    },
    [handleHabitIncrement, handleHabitUndoOnce]
  );

  const hasChildrenDeeperThan = React.useCallback((nodes: TaskTreeNode[], level: number, maxLevel: number): boolean => {
    if (nodes.length === 0) return false;
    if (level >= maxLevel) {
      return nodes.some((node) => node.children.length > 0);
    }
    return nodes.some((node) => hasChildrenDeeperThan(node.children, level + 1, maxLevel));
  }, []);

  const closeCategoryMenu = () => setCategoryModalVisible(false);
  const openCategoryEditor = (title: string, initialValue = '', categoryId: string | null = null) => {
    setCategoryEditorTitle(title);
    setCategoryInputValue(initialValue);
    setActiveCategoryId(categoryId);
    setCategoryModalVisible(false);
    setCategoryEditorVisible(true);
  };
  const closeCategoryEditor = () => {
    setCategoryEditorVisible(false);
    setCategoryModalVisible(false);
  };

  const bg = isDark ? theme.background : '#faf8ff';
  const card = isDark ? 'rgba(30, 41, 59, 0.45)' : '#ffffff';
  const modalCardBg = isDark ? 'rgba(15, 23, 42, 0.94)' : card;
  const soft = isDark ? 'rgba(51,65,85,0.55)' : '#f2f3ff';
  const outline = isDark ? 'rgba(148,163,184,0.6)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.20)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const error = isDark ? '#f87171' : '#ba1a1a';

  const buildCategoryId = React.useCallback((scope: 'task' | 'project') => {
    const prefix = scope === 'task' ? 'tc' : 'pc';
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  const scopedCategories = projectCategories;

  const saveCategory = React.useCallback(async () => {
    const name = categoryInputValue.trim();
    if (!name) {
      Alert.alert('无法保存分类', '请输入分类名称后再确认。');
      return;
    }

    const normalizedName = name.toLocaleLowerCase();
    const isDuplicateName = scopedCategories.some((category) => {
      if (activeCategoryId && category.id === activeCategoryId) return false;
      return category.name.trim().toLocaleLowerCase() === normalizedName;
    });
    if (isDuplicateName) {
      Alert.alert('无法保存分类', '分类名称不能重复，请更换后重试。');
      return;
    }

    try {
      if (categoryEditorTitle.includes('新建')) {
        await createProjectCategory({ id: buildCategoryId('project'), name });
        await loadProjectCategories();
      } else {
        if (!activeCategoryId) {
          Alert.alert('无法修改分类', '未找到要修改的分类。');
          return;
        }
        await updateProjectCategory(activeCategoryId, { name });
        await loadProjectCategories();
      }
      closeCategoryEditor();
    } catch (err) {
      console.warn('保存分类失败', err);
      Alert.alert('保存失败', '分类保存失败，请稍后重试。');
    }
  }, [
    activeCategoryId,
    buildCategoryId,
    categoryEditorTitle,
    categoryInputValue,
    closeCategoryEditor,
    loadProjectCategories,
    scopedCategories,
  ]);

  const removeCategory = React.useCallback(() => {
    if (!activeCategoryId) {
      Alert.alert('提示', '请先长按要删除的分类。');
      return;
    }
    if (activeCategoryId === 'all') {
      Alert.alert('提示', '“全部”不是可删除分类。');
      return;
    }
    if (activeCategoryId === INBOX_PROJECT_CATEGORY_ID) {
      Alert.alert('提示', '“收集箱”是内置分类，不能删除。');
      return;
    }
    const hasProjectsInCategory = projects.some(
      (project) => (project.category_id ?? INBOX_PROJECT_CATEGORY_ID) === activeCategoryId
    );
    if (hasProjectsInCategory) {
      Alert.alert('无法删除', '该分类下仍有关联项目，请先迁移或删除这些项目后再试。');
      return;
    }

    const targetName = activeCategoryLabel || scopedCategories.find((c) => c.id === activeCategoryId)?.name || '该分类';
    Alert.alert('删除分类', `确认删除「${targetName}」吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteProjectCategory(activeCategoryId);
            await loadProjectCategories();
            if (taskTab === activeCategoryId) setTaskTab('all');
            if (projectTab === activeCategoryId) setProjectTab('all');
            closeCategoryMenu();
          } catch (err) {
            console.warn('删除分类失败', err);
            Alert.alert('删除失败', '分类删除失败，请稍后重试。');
          }
        },
      },
    ]);
  }, [
    activeCategoryId,
    activeCategoryLabel,
    closeCategoryMenu,
    loadProjectCategories,
    projects,
    projectTab,
    scopedCategories,
    taskTab,
  ]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.bgOrb,
            styles.bgOrbTop,
            {
              backgroundColor: `${primary}18`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 10],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.bgOrb,
            styles.bgOrbBottom,
            {
              backgroundColor: `${secondary}16`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 10],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled">
        <Animated.View
          style={{
            opacity: pageFadeAnim,
            transform: [{ translateY: pageTranslateAnim }],
          }}
        >
          <View style={[styles.section, styles.stackedSection]}>
            <View style={styles.sectionCard}>
              <View style={styles.headerRow}>
                <View style={styles.titleRow}>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>今日青蛙</Text>
                  <MaterialIcons name="eco" size={20} color={secondary} />
                </View>
                <ScalePressable onPress={() => router.push('/add-frog')} style={({ pressed }) => [styles.ghostBtn, { borderColor: `${secondary}44` }, pressed && { opacity: 0.8 }]}>
                  <MaterialIcons name="add" size={14} color={secondary} />
                  <Text style={[styles.ghostBtnText, { color: secondary }]}>添加青蛙</Text>
                </ScalePressable>
              </View>

              <Animated.View
                style={{
                  opacity: frogCardAnim,
                  transform: [
                    {
                      translateY: frogCardAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
                    },
                    {
                      scale: frogCardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }),
                    },
                  ],
                }}
              >
                {todayFrogCards.length > 0 ? (
                  todayFrogCards.map((frog) => {
                    const isDone = frog.status === 'done' || frog.status === 'cancelled';
                    return (
                      <ScalePressable
                        key={frog.id}
                        onPress={() => openTask(frog.id)}
                        scaleTo={0.985}
                        style={({ pressed }) => [
                          styles.frogCard,
                          {
                            backgroundColor: isDone ? (isDark ? 'rgba(51, 65, 85, 0.6)' : '#eef1f6') : card,
                            borderLeftColor: secondary,
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}>
                        <View style={styles.frogIconBg} pointerEvents="none">
                          <MaterialIcons name="eco" size={52} color={`${secondary}22`} />
                        </View>
                        <View style={styles.frogTopRow}>
                          <View style={[styles.badge, { backgroundColor: `${secondary}16` }]}>
                            <Text style={[styles.badgeText, { color: secondary }]}>今日已指派</Text>
                          </View>
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation?.();
                              playFrogDoneBounce(frog.id);
                              void toggleTaskDone(frog.id);
                            }}
                            hitSlop={10}
                            style={({ pressed }) => [styles.inlineDoneBtn, pressed && { opacity: 0.75 }]}>
                            <Animated.View style={{ transform: [{ scale: getFrogDoneBounce(frog.id) }] }}>
                              <MaterialIcons
                                name={isDone ? 'check-circle' : 'radio-button-unchecked'}
                                size={20}
                                color={secondary}
                              />
                            </Animated.View>
                          </Pressable>
                        </View>
                        {frog.parent_task_id ? (
                          <Text
                            style={[
                              styles.taskParentHint,
                              { color: outline, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.65 : 1 },
                            ]}
                            numberOfLines={1}>
                            上级任务：{taskTitleById.get(frog.parent_task_id) ?? '（未找到）'}
                          </Text>
                        ) : null}
                        <Text
                          style={[
                            styles.frogTitle,
                            { color: theme.text, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.55 : 1 },
                          ]}
                          numberOfLines={2}>
                          {frog.title}
                        </Text>
                        <Text
                          style={[
                            styles.frogDesc,
                            { color: theme.textSecondary, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.58 : 1 },
                          ]}
                          numberOfLines={3}>
                          {(frog.note ?? '').trim() || '点击查看详情或继续执行。'}
                        </Text>
                        <View style={styles.progressMeta}>
                          <Text style={[styles.progressLabel, { color: outline }]}>状态</Text>
                          <Text style={[styles.progressLabel, { color: outline }]}>{isDone ? '已完成' : '进行中'}</Text>
                        </View>
                      </ScalePressable>
                    );
                  })
                ) : (
                  <View style={[styles.frogCard, { backgroundColor: card, borderLeftColor: secondary, opacity: 0.9 }]}>
                    <View style={styles.frogIconBg}>
                      <MaterialIcons name="eco" size={52} color={`${secondary}22`} />
                    </View>
                    <View style={styles.frogTopRow}>
                      <View style={[styles.badge, { backgroundColor: `${secondary}16` }]}>
                        <Text style={[styles.badgeText, { color: secondary }]}>今日未指派</Text>
                      </View>
                      <MaterialIcons name="radio-button-unchecked" size={20} color={secondary} />
                    </View>
                    <Text style={[styles.frogTitle, { color: theme.text }]}>还没有今日青蛙</Text>
                    <Text style={[styles.frogDesc, { color: theme.textSecondary }]}>点击右上角“添加青蛙”，从今日可选任务中指派。</Text>
                  </View>
                )}
              </Animated.View>
            </View>
          </View>

          <View style={[styles.section, styles.stackedSection]}>
            <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 8 }]}>任务列表</Text>
            <SegmentTabs
              tabs={taskTabs}
              active={taskTab}
              onChange={setTaskTab}
              onLongPressTab={(key, label) => openCategoryMenu('project', label, key)}
              color={primary}
              muted={outline}
            />

            <Animated.View style={{ opacity: matrixAnim, transform: [{ translateY: matrixAnim.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }}>
              <View style={[styles.matrixWrap, { borderColor: outlineVariant, backgroundColor: `${outlineVariant}28` }]}>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <PulseDot color={error} />
                      <Text style={[styles.quadTitle, { color: error }]}>紧急且重要 (立即执行)</Text>
                    </View>
                  </View>
                  {matrixGroups.q11.length === 0 ? (
                    <EmptyPlaceholder
                      icon="task-alt"
                      title="暂无任务"
                      subtitle="把重要紧急的事项放进来，优先处理。"
                      color={error}
                      muted={outline}
                      cardBg={isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(0,0,0,0.02)'}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q11.map((t) => {
                        const isDone = t.status === 'done' || t.status === 'cancelled';
                        const meta = parseTaskMeta(t.extra_data);
                        const due = t.due_date?.slice(0, 10) ?? '';
                        const repeat = (meta.repeat ?? '').trim();
                        const reminder = (meta.reminder ?? '').trim();
                        const parentTitle = t.parent_task_id ? taskTitleById.get(t.parent_task_id) : null;
                        return (
                          <ScalePressable key={t.id} style={styles.taskRow} onPress={() => openTask(t.id)} scaleTo={0.985}>
                            <MaterialIcons name={isDone ? 'check-circle' : 'radio-button-unchecked'} size={20} color={error} />
                            <View style={styles.taskBody}>
                              {!!parentTitle && (
                                <Text style={[styles.taskParentHint, { color: outline }]} numberOfLines={1}>
                                  上级任务：{parentTitle}
                                </Text>
                              )}
                              <Text
                                style={[
                                  styles.taskText,
                                  { color: theme.text, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.42 : 1 },
                                ]}
                                numberOfLines={1}>
                                {t.title}
                              </Text>
                              {!!due ? (
                                <View style={[styles.deadlineBadge, { backgroundColor: `${error}14` }]}>
                                  <Text style={[styles.deadlineText, { color: error }]}>{formatTaskDueText(due)}</Text>
                                </View>
                              ) : null}
                              {!!repeat || !!reminder ? (
                                <View style={styles.metaRow}>
                                  {!!repeat ? (
                                    <>
                                      <MaterialIcons name="refresh" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {repeat}
                                      </Text>
                                    </>
                                  ) : null}
                                  {!!reminder ? (
                                    <>
                                      <MaterialIcons name="notifications-active" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {reminder}
                                      </Text>
                                    </>
                                  ) : null}
                                </View>
                              ) : null}
                            </View>
                          </ScalePressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <View style={[styles.dot, { backgroundColor: primary }]} />
                      <Text style={[styles.quadTitle, { color: primary }]}>不紧急但重要 (计划执行)</Text>
                    </View>
                  </View>
                  {matrixGroups.q10.length === 0 ? (
                    <EmptyPlaceholder
                      icon="event-available"
                      title="暂无任务"
                      subtitle="把重要但不紧急的任务安排进计划。"
                      color={primary}
                      muted={outline}
                      cardBg={isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(0,0,0,0.02)'}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q10.map((t) => {
                        const isDone = t.status === 'done' || t.status === 'cancelled';
                        const meta = parseTaskMeta(t.extra_data);
                        const due = t.due_date?.slice(0, 10) ?? '';
                        const repeat = (meta.repeat ?? '').trim();
                        const reminder = (meta.reminder ?? '').trim();
                        const parentTitle = t.parent_task_id ? taskTitleById.get(t.parent_task_id) : null;
                        return (
                          <ScalePressable key={t.id} style={styles.taskRow} onPress={() => openTask(t.id)} scaleTo={0.985}>
                            <MaterialIcons name={isDone ? 'check-circle' : 'radio-button-unchecked'} size={20} color={primary} />
                            <View style={styles.taskBody}>
                              {!!parentTitle && (
                                <Text style={[styles.taskParentHint, { color: outline }]} numberOfLines={1}>
                                  上级任务：{parentTitle}
                                </Text>
                              )}
                              <Text
                                style={[
                                  styles.taskText,
                                  { color: theme.text, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.42 : 1 },
                                ]}
                                numberOfLines={1}>
                                {t.title}
                              </Text>
                              {!!due ? (
                                <View style={[styles.deadlineBadge, { backgroundColor: `${primary}14` }]}>
                                  <Text style={[styles.deadlineText, { color: primary }]}>{formatTaskDueText(due)}</Text>
                                </View>
                              ) : null}
                              {!!repeat || !!reminder ? (
                                <View style={styles.metaRow}>
                                  {!!repeat ? (
                                    <>
                                      <MaterialIcons name="refresh" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {repeat}
                                      </Text>
                                    </>
                                  ) : null}
                                  {!!reminder ? (
                                    <>
                                      <MaterialIcons name="notifications-active" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {reminder}
                                      </Text>
                                    </>
                                  ) : null}
                                </View>
                              ) : null}
                            </View>
                          </ScalePressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <View style={[styles.dot, { backgroundColor: tertiary }]} />
                      <Text style={[styles.quadTitle, { color: tertiary }]}>紧急但不重要 (委派他人)</Text>
                    </View>
                  </View>
                  {matrixGroups.q01.length === 0 ? (
                    <EmptyPlaceholder
                      icon="groups"
                      title="暂无任务"
                      subtitle="需要委派/协调的事项可以放这里。"
                      color={tertiary}
                      muted={outline}
                      cardBg={isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(0,0,0,0.02)'}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q01.map((t) => {
                        const isDone = t.status === 'done' || t.status === 'cancelled';
                        const meta = parseTaskMeta(t.extra_data);
                        const due = t.due_date?.slice(0, 10) ?? '';
                        const repeat = (meta.repeat ?? '').trim();
                        const reminder = (meta.reminder ?? '').trim();
                        const parentTitle = t.parent_task_id ? taskTitleById.get(t.parent_task_id) : null;
                        return (
                          <ScalePressable key={t.id} style={styles.taskRow} onPress={() => openTask(t.id)} scaleTo={0.985}>
                            <MaterialIcons name={isDone ? 'check-circle' : 'radio-button-unchecked'} size={20} color={tertiary} />
                            <View style={styles.taskBody}>
                              {!!parentTitle && (
                                <Text style={[styles.taskParentHint, { color: outline }]} numberOfLines={1}>
                                  上级任务：{parentTitle}
                                </Text>
                              )}
                              <Text
                                style={[
                                  styles.taskText,
                                  { color: theme.text, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.42 : 1 },
                                ]}
                                numberOfLines={1}>
                                {t.title}
                              </Text>
                              {!!due ? (
                                <View style={[styles.deadlineBadge, { backgroundColor: `${tertiary}14` }]}>
                                  <Text style={[styles.deadlineText, { color: tertiary }]}>{formatTaskDueText(due)}</Text>
                                </View>
                              ) : null}
                              {!!repeat || !!reminder ? (
                                <View style={styles.metaRow}>
                                  {!!repeat ? (
                                    <>
                                      <MaterialIcons name="refresh" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {repeat}
                                      </Text>
                                    </>
                                  ) : null}
                                  {!!reminder ? (
                                    <>
                                      <MaterialIcons name="notifications-active" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {reminder}
                                      </Text>
                                    </>
                                  ) : null}
                                </View>
                              ) : null}
                            </View>
                          </ScalePressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
                <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
                  <View style={styles.quadHead}>
                    <View style={styles.quadTitleRow}>
                      <View style={[styles.dot, { backgroundColor: outline }]} />
                      <Text style={[styles.quadTitle, { color: outline }]}>不紧急不重要 (尽量消除)</Text>
                    </View>
                  </View>
                  {matrixGroups.q00.length === 0 ? (
                    <EmptyPlaceholder
                      icon="self-improvement"
                      title="暂无任务"
                      subtitle="不重要不紧急的事，能不做就不做。"
                      color={outline}
                      muted={outline}
                      cardBg={isDark ? 'rgba(15, 23, 42, 0.35)' : 'rgba(0,0,0,0.02)'}
                    />
                  ) : (
                    <ScrollView style={styles.quadList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                      {matrixGroups.q00.map((t) => {
                        const isDone = t.status === 'done' || t.status === 'cancelled';
                        const meta = parseTaskMeta(t.extra_data);
                        const due = t.due_date?.slice(0, 10) ?? '';
                        const repeat = (meta.repeat ?? '').trim();
                        const reminder = (meta.reminder ?? '').trim();
                        const parentTitle = t.parent_task_id ? taskTitleById.get(t.parent_task_id) : null;
                        return (
                          <ScalePressable key={t.id} style={styles.taskRow} onPress={() => openTask(t.id)} scaleTo={0.985}>
                            <MaterialIcons name={isDone ? 'check-circle' : 'radio-button-unchecked'} size={20} color={outline} />
                            <View style={styles.taskBody}>
                              {!!parentTitle && (
                                <Text style={[styles.taskParentHint, { color: outline }]} numberOfLines={1}>
                                  上级任务：{parentTitle}
                                </Text>
                              )}
                              <Text
                                style={[
                                  styles.taskText,
                                  { color: theme.text, textDecorationLine: isDone ? 'line-through' : 'none', opacity: isDone ? 0.42 : 1 },
                                ]}
                                numberOfLines={1}>
                                {t.title}
                              </Text>
                              {!!due ? (
                                <View style={[styles.deadlineBadge, { backgroundColor: `${outline}12` }]}>
                                  <Text style={[styles.deadlineText, { color: outline }]}>{formatTaskDueText(due)}</Text>
                                </View>
                              ) : null}
                              {!!repeat || !!reminder ? (
                                <View style={styles.metaRow}>
                                  {!!repeat ? (
                                    <>
                                      <MaterialIcons name="refresh" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {repeat}
                                      </Text>
                                    </>
                                  ) : null}
                                  {!!reminder ? (
                                    <>
                                      <MaterialIcons name="notifications-active" size={12} color={outline} />
                                      <Text style={[styles.metaHint, { color: outline }]} numberOfLines={1}>
                                        {reminder}
                                      </Text>
                                    </>
                                  ) : null}
                                </View>
                              ) : null}
                            </View>
                          </ScalePressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </View>
            </Animated.View>
          </View>

          <Animated.View style={{ opacity: projectAnim, transform: [{ translateY: projectAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }}>
            <View style={[styles.section, styles.stackedSection]}>
              <View style={styles.sectionCard}>
                <View style={styles.headerRow}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.sectionTitle, { color: theme.text }]}>项目列表</Text>
                    <Text style={[styles.sectionMeta, { color: outline }]}>共 {projects.length} 个活跃项目</Text>
                  </View>
                  <ScalePressable
                    onPress={() =>
                      router.push(
                        projectTab === 'all'
                          ? '/add-project'
                          : { pathname: '/add-project', params: { categoryId: projectTab } },
                      )
                    }
                    style={({ pressed }) => [styles.ghostBtn, { borderColor: `${primary}44` }, pressed && { opacity: 0.8 }]}>
                    <MaterialIcons name="add-circle" size={14} color={primary} />
                    <Text style={[styles.ghostBtnText, { color: primary }]}>新建项目</Text>
                  </ScalePressable>
                </View>
                <SegmentTabs
                  tabs={projectTabs}
                  active={projectTab}
                  onChange={setProjectTab}
                  onLongPressTab={(key, label) => openCategoryMenu('project', label, key)}
                  color={primary}
                  muted={outline}
                />
                {(projectTab === 'all'
                  ? projects
                  : projects.filter((project) => (project.category_id ?? INBOX_PROJECT_CATEGORY_ID) === projectTab)
                ).map((project, index) => {
                  const isFirst = index === 0;
                  const isCompleted = project.status === 'completed' || project.status === 'archived';
                  const schedule = parseProjectSchedule(project.extra_data);
                  const dueDateLabel = getProjectScheduleLabel(project, schedule);
                  const isRangeSchedule = !!(schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end);
                  const todayYmd = formatLocalYmd(new Date());
                  const rangeEndYmd = isRangeSchedule ? formatScheduleDateToYMD(schedule!.range!.end) : null;
                  const dueYmd = !isRangeSchedule && project.due_date ? formatScheduleDateToYMD(project.due_date) : null;
                  const isExpiredRange = (() => {
                    if (!rangeEndYmd) return false;
                    const end = ymdToLocalDate(rangeEndYmd);
                    const today = ymdToLocalDate(todayYmd);
                    if (!end || !today) return false;
                    return today.getTime() > end.getTime();
                  })();
                  const isExpiredDue = (() => {
                    if (!dueYmd) return false;
                    const due = ymdToLocalDate(dueYmd);
                    const today = ymdToLocalDate(todayYmd);
                    if (!due || !today) return false;
                    return today.getTime() > due.getTime();
                  })();
                  const noteText = project.note?.trim();
                  const categoryLabel = !project.category_id || project.category_id === INBOX_PROJECT_CATEGORY_ID ? '收集箱' : projectCategoryMap.get(project.category_id) ?? '未分类';
                  const hasReminder = !!schedule?.reminderOption && schedule.reminderOption !== '不提前';
                  const hasRepeat = !!schedule?.repeatOption && schedule.repeatOption !== '不重复';
                  const taskTree = sortTaskTree(projectTaskTreeMap[project.id] ?? []);
                  const isExpanded = !!expandedProjectIds[project.id];
                  const progress = (() => {
                    // 只统计项目的直接子任务（第一层），不递归统计更深层级
                    const total = taskTree.length;
                    const done = taskTree.reduce((acc, n) => {
                      if (n.status === 'done' || n.status === 'cancelled') return acc + 1;
                      return acc;
                    }, 0);
                    const ratio = total > 0 ? done / total : 0;
                    return { total, done, ratio };
                  })();

                  const openEditTask = (id: string) => {
                    router.push({ pathname: '/edit-task', params: { id } });
                  };

                  const renderTaskTree = (nodes: TaskTreeNode[], level: number): React.ReactNode => {
                    if (nodes.length === 0 || level > 3) return null;
                    return nodes.map((node) => {
                      const isDone = node.status === 'done' || node.status === 'cancelled';
                      const childrenAll = Array.isArray(node.children) ? node.children : [];
                      const children = level < 3 ? childrenAll : [];
                      const hasAnyChildren = childrenAll.length > 0;
                      const hasChildrenToRender = children.length > 0;
                      const hasDeeperLevels = level === 3 && hasAnyChildren;
                      const canToggleCollapse = level === 1 && hasAnyChildren;
                      const isCollapsed = canToggleCollapse ? !!collapsedTaskIds[node.id] : false;
                      const isExpandedTask = canToggleCollapse ? !isCollapsed : true;
                      const noteText = (node.note ?? '').trim();
                      const hintPaddingLeft =
                        10 +
                        level * TASK_INDENT +
                        (canToggleCollapse ? 22 + 8 : 0) +
                        14 +
                        8;
                      return (
                        <React.Fragment key={node.id}>
                          <Pressable
                            onPress={() => openEditTask(node.id)}
                            hitSlop={8}
                            style={({ pressed }) => [
                              styles.projectTaskRow,
                              {
                                paddingLeft: 10,
                                paddingVertical: 10,
                                marginTop: 6,
                                borderRadius: 10,
                                backgroundColor: isDark ? 'rgba(15, 23, 42, 0.72)' : '#fff',
                                borderBottomWidth: StyleSheet.hairlineWidth,
                                borderBottomColor: isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(203,213,225,0.9)',
                                opacity: pressed ? 0.85 : 1,
                              },
                            ]}>
                            <View style={styles.treeColumns}>
                              {Array.from({ length: level }).map((_, idx) => (
                                <View key={`${node.id}_col_${idx}`} style={[styles.treeColumn, { width: TASK_INDENT }]}>
                                  {/* keep column width for indentation; no connector line */}
                                </View>
                              ))}
                            </View>
                            <View
                              style={[
                                styles.statusCircle,
                                { borderColor: primary, backgroundColor: isDone ? primary : 'transparent' },
                              ]}>
                              {isDone ? <MaterialIcons name="check" size={12} color="#fff" /> : null}
                            </View>
                            <View style={styles.projectTaskMain}>
                              <View style={styles.taskTitleRow}>
                                <Text
                                  style={[
                                    styles.projectTaskText,
                                    {
                                      color: isDone ? '#6b7280' : theme.text,
                                      textDecorationLine: isDone ? 'line-through' : 'none',
                                      opacity: isDone ? 0.85 : 1,
                                    },
                                  ]}
                                  numberOfLines={1}>
                                  {node.title}
                                </Text>
                                {level === 1 && isDone ? <Text style={styles.taskDoneTag}>已完成</Text> : null}
                              </View>
                              {(() => {
                                const meta = parseTaskMeta(node.extra_data);
                                const priorityLabel = formatTaskPriority(node.priority);
                                const priorityColor = getTaskPriorityColor(node.priority, isDark);
                                const dueDate = node.due_date?.slice(0, 10) ?? '';
                                const reminder = (meta.reminder ?? '').trim();
                                const repeat = (meta.repeat ?? '').trim();
                                return (
                                  <View style={styles.projectTaskMetaRow}>
                                    {!!priorityLabel && (
                                      <View style={[styles.projectTaskMetaChip, { backgroundColor: `${priorityColor}14`, borderColor: `${priorityColor}40` }]}>
                                        <MaterialIcons name="flag" size={11} color={priorityColor} />
                                        <Text style={[styles.projectTaskMetaText, { color: priorityColor }]}>{priorityLabel}</Text>
                                      </View>
                                    )}
                                    {!!dueDate && (
                                      <View style={[styles.projectTaskMetaChip, { borderColor: outlineVariant }]}>
                                        <MaterialIcons name="event" size={11} color={outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: outline }]}>{formatTaskDueText(dueDate)}</Text>
                                      </View>
                                    )}
                                    {!!repeat && (
                                      <View style={[styles.projectTaskMetaChip, { borderColor: outlineVariant }]}>
                                        <MaterialIcons name="repeat" size={11} color={outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: outline }]}>{repeat}</Text>
                                      </View>
                                    )}
                                    {!!reminder && (
                                      <View style={[styles.projectTaskMetaChip, { borderColor: outlineVariant }]}>
                                        <MaterialIcons name="notifications-active" size={11} color={outline} />
                                        <Text style={[styles.projectTaskMetaText, { color: outline }]}>{reminder}</Text>
                                      </View>
                                    )}
                                  </View>
                                );
                              })()}
                              {hasAnyChildren ? (() => {
                                const directTotal = childrenAll.length;
                                if (directTotal <= 0) return null;
                                const directDone = childrenAll.reduce((acc, child) => {
                                  if (child.status === 'done' || child.status === 'cancelled') return acc + 1;
                                  return acc;
                                }, 0);
                                const ratio = directDone / directTotal;
                                return (
                                  <>
                                    <View style={styles.projectTaskProgressRow}>
                                      <Text style={[styles.projectTaskProgressLabel, { color: outline }]}>
                                        进度 {directDone}/{directTotal}
                                      </Text>
                                      <Text style={[styles.projectTaskProgressLabel, { color: outline }]}>
                                        {Math.round(ratio * 100)}%
                                      </Text>
                                    </View>
                                    <View
                                      style={[
                                        styles.projectTaskProgressTrack,
                                        { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : '#e2e7ff' },
                                      ]}>
                                      <View
                                        style={[
                                          styles.projectTaskProgressFill,
                                          { backgroundColor: primary, width: `${Math.round(ratio * 100)}%` },
                                        ]}
                                      />
                                    </View>
                                  </>
                                );
                              })() : null}
                              {!!noteText && (
                                <View style={[styles.projectTaskNoteWrap, { backgroundColor: `${primary}0E`, borderLeftColor: primary }]}>
                                  <Text style={[styles.projectTaskNoteText, { color: theme.textSecondary }]} numberOfLines={2}>
                                    {noteText}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </Pressable>
                          {hasChildrenToRender && isExpandedTask ? renderTaskTree(children, level + 1) : null}
                          {hasDeeperLevels && isExpandedTask ? (
                            <Text
                              style={[
                                styles.projectTaskEllipsisInline,
                                {
                                  color: '#6b7280',
                                  paddingLeft: hintPaddingLeft,
                                },
                              ]}>
                              还有更深层级任务
                            </Text>
                          ) : null}
                        </React.Fragment>
                      );
                    });
                  };

                  const hasAnyTasks = taskTree.length > 0;
                  return (
                    <ScalePressable
                      key={project.id}
                      onPress={() => openProject(project.id)}
                      hitSlop={6}
                      scaleTo={0.988}
                      style={[
                        styles.projectCard,
                        {
                          backgroundColor: isFirst ? card : soft,
                          opacity: isFirst ? 1 : 0.86,
                        },
                      ]}>
                      <View
                        style={[
                          styles.projectHead,
                          { borderLeftColor: primary },
                        ]}>
                        <View style={styles.projectHeadLeft}>
                          <MaterialIcons name={isFirst ? 'inventory-2' : 'data-usage'} size={22} color={primary} />
                          <View style={styles.projectHeadMainColumn}>
                            <Text style={[styles.projectTitle, { color: theme.text }]}>{project.name}</Text>
                            <View style={styles.projectSubRow}>
                              {dueDateLabel ? (
                                <Text style={[styles.projectSub, { color: outline }]}>
                                  {isRangeSchedule
                                    ? isExpiredRange && rangeEndYmd
                                      ? `已于：${formatYmdCN(rangeEndYmd)} 过期`
                                      : dueDateLabel
                                    : isExpiredDue && dueYmd
                                      ? `已于：${formatYmdCN(dueYmd)} 过期`
                                      : dueYmd
                                        ? formatProjectDueText(dueYmd)
                                        : `截止 ${dueDateLabel}`}
                                </Text>
                              ) : (
                                <Text style={[styles.projectSub, { color: outline }]}>无截止日期</Text>
                              )}
                              <Text style={[styles.projectSub, { color: outline }]}>•</Text>
                              <Text style={[styles.projectSub, { color: outline }]}>分类 {categoryLabel}</Text>
                            </View>
                            {noteText ? (
                              <View style={[styles.projectNoteWrap, { backgroundColor: `${primary}12`, borderLeftColor: primary }]}>
                                <Text style={[styles.projectNote, { color: theme.textSecondary }]} numberOfLines={2}>
                                  {noteText}
                                </Text>
                              </View>
                            ) : null}
                            <View style={styles.projectMetaRow}>
                              <Text style={[styles.projectSubStrong, { color: primary }]}>{project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : isCompleted ? '已完成' : '未知状态'}</Text>
                              {(hasReminder || hasRepeat) && <Text style={[styles.projectSub, { color: outline }]}>•</Text>}
                              {hasReminder && (
                                <View style={styles.projectFlag}>
                                  <MaterialIcons name="notifications-active" size={11} color={primary} />
                                  <Text style={[styles.projectFlagText, { color: primary }]}>提醒</Text>
                                </View>
                              )}
                              {hasRepeat && (
                                <View style={styles.projectFlag}>
                                  <MaterialIcons name="repeat" size={11} color={primary} />
                                  <Text style={[styles.projectFlagText, { color: primary }]}>重复</Text>
                                </View>
                              )}
                            </View>
                            {progress.total > 0 ? (
                              <>
                                <View style={styles.projectProgressRow}>
                                  <Text style={[styles.projectProgressLabel, { color: outline }]}>
                                    进度 {progress.done}/{progress.total}
                                  </Text>
                                  <Text style={[styles.projectProgressLabel, { color: outline }]}>
                                    {Math.round(progress.ratio * 100)}%
                                  </Text>
                                </View>
                                <View
                                  style={[
                                    styles.projectProgressTrack,
                                    { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : '#e2e7ff' },
                                  ]}>
                                  <View
                                    style={[
                                      styles.projectProgressFill,
                                      { backgroundColor: primary, width: `${Math.round(progress.ratio * 100)}%` },
                                    ]}
                                  />
                                </View>
                              </>
                            ) : null}
                          </View>
                        </View>
                        <View style={styles.projectHeadRight}>
                          {hasAnyTasks ? (
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation();
                                toggleProjectExpand(project.id);
                              }}
                              hitSlop={8}
                              style={({ pressed }) => [styles.projectExpandBtn, pressed && { opacity: 0.75 }]}>
                              <MaterialIcons name={isExpanded ? 'expand-less' : 'expand-more'} size={20} color={outline} />
                            </Pressable>
                          ) : null}
                        </View>
                      </View>
                      {(!hasAnyTasks || isExpanded) && (
                        <View style={[styles.projectTaskBody, { borderTopColor: outlineVariant }]}>
                          {!hasAnyTasks ? (
                            <Text style={[styles.projectTaskEmpty, { color: outline }]}>暂无任务</Text>
                          ) : (
                            <>
                              {renderTaskTree(taskTree, 1)}
                            </>
                          )}
                        </View>
                      )}
                    </ScalePressable>
                  );
                })}
                {(projectTab === 'all'
                  ? projects
                  : projects.filter((project) => (project.category_id ?? INBOX_PROJECT_CATEGORY_ID) === projectTab)
                ).length === 0 && (
                  <View style={[styles.projectCard, { backgroundColor: soft, opacity: 0.86 }]}>
                    <View style={[styles.projectHead, { borderLeftColor: outline }]}> 
                      <View style={styles.projectHeadLeft}>
                        <MaterialIcons name="folder-open" size={22} color={outline} />
                        <View style={styles.projectHeadMainColumn}>
                          <Text style={[styles.projectTitle, { color: theme.textSecondary }]}>暂无项目</Text>
                          <Text style={[styles.projectSub, { color: outline }]}>可点击右上角“新建项目”添加</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </Animated.View>

          <View style={[styles.section, styles.stackedSection]}>
            <View style={styles.sectionCard}>
              <View style={styles.habitHeaderRow}>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>小习惯</Text>
                <ScalePressable
                  onPress={() => router.push('/habit-manage')}
                  style={({ pressed }) => [
                    styles.ghostBtn,
                    { borderColor: `${primary}44` },
                    pressed && { opacity: 0.8 },
                  ]}>
                  <MaterialIcons name="dashboard" size={14} color={primary} />
                  <Text style={[styles.ghostBtnText, { color: primary }]}>管理习惯</Text>
                </ScalePressable>
              </View>

              {habitSections.map((section) => {
                const isOpen = expandedHabitSections[section.id] ?? true;
                return (
                  <View key={section.id} style={styles.habitSection}>
                    <Pressable
                      onPress={() => toggleHabitSection(section.id)}
                      style={({ pressed }) => [
                        styles.habitSectionToggle,
                        { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(148,163,184,0.14)' },
                        pressed && { opacity: 0.8 },
                      ]}>
                      <Text style={[styles.habitSectionToggleText, { color: outline }]}>
                        {section.title}・{section.items.length}
                      </Text>
                      <MaterialIcons name={isOpen ? 'expand-less' : 'expand-more'} size={16} color={outline} />
                    </Pressable>

                    {isOpen ? (
                      <View style={styles.habitItemsRow} onLayout={onHabitItemsRowLayout}>
                        {section.items.map((item) => {
                          const hasProgress = item.todayCount > 0;
                          const goalMet =
                            item.dailyGoalMax != null
                              ? item.todayCount >= item.dailyGoalMax
                              : item.todayCount > 0;

                          const openHabitEdit = () =>
                            router.push({
                              pathname: '/add-habit',
                              params: {
                                mode: 'edit',
                                name: item.name,
                                icon: item.icon,
                                context: section.title,
                                habitId: item.id,
                              },
                            });

                          const partialBorder = isDark ? 'rgba(52,211,153,0.5)' : 'rgba(0,108,73,0.42)';

                          return (
                            <View key={item.id} style={[styles.habitItem, { width: habitGridItemWidth }]}>
                              <Pressable
                                onPress={() => handleHabitIconPress(item)}
                                onLongPress={openHabitEdit}
                                delayLongPress={260}
                                style={({ pressed }) => [styles.habitIconPressable, pressed && { opacity: 0.86 }]}>
                                <View style={styles.habitIconWrap}>
                                  <View
                                    style={[
                                      styles.habitIconCircle,
                                      {
                                        borderColor: goalMet
                                          ? secondary
                                          : hasProgress
                                            ? partialBorder
                                            : isDark
                                              ? 'rgba(148,163,184,0.42)'
                                              : 'rgba(148,163,184,0.5)',
                                        borderStyle: goalMet ? 'solid' : 'dashed',
                                        backgroundColor: card,
                                      },
                                    ]}>
                                    <Text style={[styles.habitIconText, goalMet && styles.habitIconTextDone]}>
                                      {item.icon}
                                    </Text>
                                    {goalMet ? (
                                      <View style={styles.habitIconDoneOverlay} pointerEvents="none">
                                        <MaterialIcons name="check" size={30} color={secondary} />
                                      </View>
                                    ) : null}
                                  </View>
                                  {goalMet ? (
                                    <View style={[styles.habitTodayBadge, { borderColor: card, backgroundColor: secondary }]}>
                                      <MaterialIcons name="check" size={11} color="#fff" />
                                    </View>
                                  ) : hasProgress ? (
                                    <View
                                      style={[
                                        styles.habitTodayBadge,
                                        {
                                          borderColor: card,
                                          backgroundColor: isDark ? 'rgba(52,211,153,0.92)' : 'rgba(0,108,73,0.88)',
                                        },
                                      ]}>
                                      <Text style={styles.habitTodayBadgeCount}>{item.todayCount}</Text>
                                    </View>
                                  ) : null}
                                </View>
                              </Pressable>
                              <Pressable
                                onPress={() => void handleHabitIncrement(item.id, item.dailyGoalMax)}
                                onLongPress={openHabitEdit}
                                delayLongPress={260}
                                style={({ pressed }) => [styles.habitNamePressable, pressed && { opacity: 0.86 }]}>
                                <Text style={[styles.habitItemText, { color: theme.text }]} numberOfLines={2}>
                                  {item.name}
                                </Text>
                              </Pressable>
                            </View>
                          );
                        })}
                        <Pressable
                          onPress={() => router.push('/add-habit')}
                          style={({ pressed }) => [
                            styles.habitItem,
                            { width: habitGridItemWidth },
                            pressed && { opacity: 0.86 },
                          ]}>
                          <View
                            style={[
                              styles.habitAddCircle,
                              { backgroundColor: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)' },
                            ]}>
                            <MaterialIcons name="add" size={34} color={isDark ? '#94a3b8' : '#9ca3af'} />
                          </View>
                          <Text style={[styles.habitAddText, { color: isDark ? '#94a3b8' : '#9ca3af' }]}>添加打卡</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </View>

          <View style={{ height: 28 }} />
        </Animated.View>
      </ScrollView>

      <Modal visible={categoryModalVisible} transparent animationType="fade" onRequestClose={closeCategoryMenu}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeCategoryMenu} />
          <View pointerEvents="box-none" style={styles.modalCenter}>
            <View style={[styles.modalCard, { backgroundColor: modalCardBg }]}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalTitleWrap, { backgroundColor: `${primary}12` }]}>
                  <MaterialIcons name="folder-open" size={18} color={primary} />
                  <View>
                    <Text style={[styles.modalTitle, { color: theme.text }]}>{activeCategoryLabel}</Text>
                    <Text style={[styles.modalSubtitle, { color: outline }]}>编辑分类</Text>
                  </View>
                </View>
                <Pressable onPress={closeCategoryMenu} hitSlop={10}>
                  <MaterialIcons name="close" size={22} color={outline} />
                </Pressable>
              </View>

              <View style={styles.modalActions}>
                {[
                  { icon: 'add', label: '新建分类', color: primary, onPress: () => openCategoryEditor('新建分类') },
                  { icon: 'sort', label: '排序分类', color: secondary, onPress: () => {
                    closeCategoryMenu();
                    router.push({ pathname: '/category-sort', params: { scope: 'project' } });
                  } },
                  { icon: 'edit', label: '修改分类', color: tertiary, onPress: () => {
                    if (!activeCategoryId) {
                      Alert.alert('提示', '请先长按某个分类进入。');
                      return;
                    }
                    if (activeCategoryId === 'all') {
                      Alert.alert('提示', '“全部”不是可编辑分类。');
                      return;
                    }
                    if (activeCategoryId === INBOX_PROJECT_CATEGORY_ID) {
                      Alert.alert('提示', '“收集箱”是内置分类，不能改名。');
                      return;
                    }
                    const fallbackName = scopedCategories.find((c) => c.id === activeCategoryId)?.name ?? '';
                    openCategoryEditor('修改分类', categoryInputValue || fallbackName, activeCategoryId);
                  } },
                  { icon: 'delete', label: '删除分类', color: error, onPress: removeCategory },
                ].map((action) => (
                  <Pressable key={action.label} onPress={action.onPress} style={({ pressed }) => [styles.actionItem, { borderColor: `${action.color}22` }, pressed && { opacity: 0.8 }]}>
                    <View style={[styles.actionIcon, { backgroundColor: `${action.color}14` }]}>
                      <MaterialIcons name={action.icon as any} size={18} color={action.color} />
                    </View>
                    <Text style={[styles.actionText, { color: theme.text }]}>{action.label}</Text>
                    <MaterialIcons name="chevron-right" size={20} color={outline} />
                  </Pressable>
                ))}
              </View>

            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={categoryEditorVisible} transparent animationType="fade" onRequestClose={closeCategoryEditor}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeCategoryEditor} />
          <View pointerEvents="box-none" style={styles.modalCenter}>
            <View style={[styles.editorCard, { backgroundColor: modalCardBg }]}>
              <Text style={[styles.editorTitle, { color: theme.text }]}>{categoryEditorTitle}</Text>
              <Text style={[styles.editorHint, { color: outline }]}>请输入分类名称后确认</Text>
              <View style={[styles.editorInputWrap, { borderColor: outlineVariant, backgroundColor: isDark ? 'rgba(15,23,42,0.5)' : '#f8f9ff' }]}>
                <TextInput
                  style={[styles.editorInput, { color: theme.text }]}
                  placeholder="例如：工作任务"
                  placeholderTextColor={outline}
                  value={categoryInputValue}
                  onChangeText={setCategoryInputValue}
                  underlineColorAndroid="transparent"
                  {...(Platform.OS === 'android'
                    ? { includeFontPadding: false, textAlignVertical: 'center' as const }
                    : {})}
                />
              </View>
              <View style={styles.editorActions}>
                <Pressable onPress={closeCategoryEditor} style={({ pressed }) => [styles.editorGhostBtn, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.editorGhostText, { color: outline }]}>取消</Text>
                </Pressable>
                <Pressable onPress={saveCategory} style={({ pressed }) => [styles.editorPrimaryBtn, { backgroundColor: primary }, pressed && { opacity: 0.9 }]}>
                  <Text style={styles.editorPrimaryText}>确认</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 18 },
  bgOrb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 999,
  },
  bgOrbTop: {
    top: 20,
    right: -52,
  },
  bgOrbBottom: {
    top: 440,
    left: -74,
  },
  section: { gap: 12 },
  stackedSection: {
    marginTop: 10,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.18)',
  },
  sectionCard: {
    borderRadius: 20,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    gap: 12,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  sectionMeta: { fontSize: 12, fontWeight: '600' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ghostBtnText: { fontSize: 12, fontWeight: '800' },

  frogCard: {
    borderRadius: 18,
    borderLeftWidth: 4,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  frogIconBg: { position: 'absolute', right: 8, top: 8 },
  frogTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  inlineDoneBtn: { borderRadius: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  frogTitle: { fontSize: 20, fontWeight: '800', marginBottom: 6, paddingRight: 40 },
  frogDesc: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 10, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%' },

  frogDoneCard: {
    borderRadius: 18,
    borderLeftWidth: 4,
    padding: 16,
  },
  frogDoneRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
  frogDoneTitle: { fontSize: 17, fontWeight: '800', textDecorationLine: 'line-through', opacity: 0.45, flex: 1 },

  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
    marginBottom: 2,
  },
  segmentBtn: { paddingBottom: 8 },
  segmentText: {
    fontSize: 14,
    letterSpacing: 0.4,
    borderBottomWidth: 2,
    paddingBottom: 8,
  },

  matrixWrap: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  quadrant: {
    width: '50%',
    minHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  quadHead: { marginBottom: 2 },
  quadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quadTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  quadList: { maxHeight: 190 },
  quadEmpty: { fontSize: 12, fontWeight: '700', opacity: 0.7 },
  emptyWrap: {
    flex: 1,
    minHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 14,
    gap: 8,
  },
  emptyIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', opacity: 0.9 },
  emptySubtitle: { fontSize: 11, fontWeight: '700', opacity: 0.7, textAlign: 'center', lineHeight: 16 },

  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.18)',
  },
  taskDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskBody: { flex: 1, gap: 4 },
  taskParentHint: { fontSize: 10, fontWeight: '700', opacity: 0.7, letterSpacing: 0.2 },
  taskText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  deadlineBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  deadlineText: { fontSize: 10, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, fontWeight: '700' },
  metaHint: { fontSize: 10, fontWeight: '800' },

  pulseWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 10, height: 10, borderRadius: 999 },
  pulseCenter: { width: 7, height: 7, borderRadius: 999 },

  projectCard: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderLeftWidth: 4,
  },
  projectHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 10 },
  projectHeadMainColumn: { flex: 1, minWidth: 0 },
  projectHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectExpandBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projectTitle: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  projectSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  projectNoteWrap: {
    marginTop: 6,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  projectNote: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  projectMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  projectSub: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  projectSubStrong: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  projectFlag: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  projectFlagText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  projectProgressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 6 },
  projectProgressLabel: { fontSize: 10, fontWeight: '800' },
  projectProgressTrack: { height: 6, borderRadius: 999, overflow: 'hidden', alignSelf: 'stretch' },
  projectProgressFill: { height: '100%' },
  projectCount: { alignItems: 'flex-end' },
  projectCountMain: { fontSize: 12, fontWeight: '900' },
  projectCountSub: { fontSize: 10, fontWeight: '700' },

  projectTaskBody: { borderTopWidth: 1, paddingHorizontal: 10, paddingVertical: 10, gap: 6 },
  projectTaskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 24 },
  taskExpandBtn: {
    width: 22,
    height: 22,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -3,
  },
  taskExpandBtnPlaceholder: { width: 22, height: 22, marginTop: -3 },
  treeColumns: { flexDirection: 'row', alignSelf: 'stretch' },
  treeColumn: { alignSelf: 'stretch', position: 'relative' },
  treeLine: {
    position: 'absolute',
    left: 9,
    top: -14,
    bottom: -14,
    width: 1,
    backgroundColor: 'rgba(203,213,225,0.9)',
  },
  statusCircle: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  taskTitleDoneMain: { color: '#6b7280', textDecorationLine: 'line-through' },
  taskDoneTag: { color: '#6b7280', fontSize: 12, fontWeight: '700' },
  projectTaskMain: { flex: 1, gap: 4, paddingTop: 1 },
  projectTaskText: { flex: 1, fontSize: 13, fontWeight: '600' },
  projectTaskTextDone: { textDecorationLine: 'line-through' },
  projectTaskMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  projectTaskMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  projectTaskMetaText: { fontSize: 10, fontWeight: '700' },
  projectTaskProgressRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginBottom: 4 },
  projectTaskProgressLabel: { fontSize: 10, fontWeight: '800' },
  projectTaskProgressTrack: { height: 5, borderRadius: 999, overflow: 'hidden' },
  projectTaskProgressFill: { height: '100%' },
  projectTaskNoteWrap: {
    marginTop: 2,
    borderLeftWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  projectTaskNoteText: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  projectTaskEmpty: { fontSize: 12, fontWeight: '700' },
  projectTaskEllipsis: { marginTop: 2, fontSize: 11, fontWeight: '700' },
  projectTaskEllipsisInline: { marginTop: 2, fontSize: 11, fontWeight: '700' },
  projectBody: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  subtaskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  subtaskLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  subtaskText: { fontSize: 13, fontWeight: '600' },
  subtaskStatus: { fontSize: 10, fontWeight: '800' },
  nested: { marginLeft: 12, paddingLeft: 12, borderLeftWidth: 1, gap: 4 },

  flatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 0 },
  flatLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1, paddingRight: 10 },
  priorityBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  priorityText: { fontSize: 10, fontWeight: '900' },

  modalRoot: { flex: 1 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.38)',
  },
  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.16)',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 12 },
  modalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 16, flex: 1 },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalSubtitle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  modalActions: { gap: 10 },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  actionIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionText: { flex: 1, fontSize: 14, fontWeight: '700' },

  editorCard: {
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.16)',
    gap: 12,
  },
  editorTitle: { fontSize: 18, fontWeight: '800' },
  editorHint: { fontSize: 12, fontWeight: '600' },
  editorInputWrap: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'android' ? 4 : 10,
  },
  editorInput: {
    width: '100%',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 22,
    paddingVertical: Platform.OS === 'android' ? 12 : 8,
    minHeight: 44,
  },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  editorGhostBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  editorGhostText: { fontSize: 14, fontWeight: '700' },
  editorPrimaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  editorPrimaryText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  habitHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  habitSection: { gap: 10 },
  habitSectionToggle: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  habitSectionToggleText: { fontSize: 13, fontWeight: '800' },
  habitItemsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: HABIT_GRID_GAP },
  habitItem: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
  },
  habitIconPressable: { alignItems: 'center' },
  habitNamePressable: { alignItems: 'center', alignSelf: 'stretch', paddingHorizontal: 2 },
  habitIconWrap: {
    position: 'relative',
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitIconCircle: {
    position: 'relative',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitIconText: { fontSize: 34 },
  habitIconTextDone: { opacity: 0.35 },
  habitIconDoneOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitTodayBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  habitTodayBadgeCount: { color: '#fff', fontSize: 10, fontWeight: '800' },
  habitItemText: { fontSize: 13, fontWeight: '800', textAlign: 'center', lineHeight: 19 },
  habitAddCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitAddText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },

});
