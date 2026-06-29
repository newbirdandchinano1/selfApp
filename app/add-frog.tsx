import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { ApiRequestError } from '@/lib/api-client';
import { assignFrogToApi, getFrogAssignedOn, unassignFrogFromApi } from '@/lib/frog-assignment';
import { fetchTodayFrogs } from '@/lib/today-frogs-api';
import {
  addDaysToLogicalYmd,
  DEFAULT_TASKS_DAY_BOUNDARY,
  getLogicalLocalYmd,
  loadTasksDayBoundary,
  logicalYmdToLocalDate,
} from '@/lib/tasks-logical-day';
import { isLogicalDayInYmdRange } from '@/lib/repositories/projects/project-schedule-status';
import { buildProjectLockMap } from '@/lib/repositories/projects/project-prerequisites';
import { getProjects } from '@/lib/repositories/projects/project';
import { getTasks, getTasksByProjectId, type TaskTreeNode } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { standaloneTodoEditorHref } from '@/lib/standalone-todo-task';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Item = {
  id: string;
  title: string;
  parentLabel: string | null;
  projectLabel: string | null;
  subtitle: string;
  tone: 'error' | 'primary' | 'tertiary' | 'outline';
  /** 有截止日期时用于组内排序：时间戳升序；无日期为 null */
  dueSortKey: number | null;
  priority: number;
};

type Section = {
  key: string;
  title: string;
  badge: string;
  tone: Item['tone'];
  items: Item[];
  /** 过期栏：标题标红加粗 */
  emphasize?: boolean;
};

type TaskScheduleMeta = {
  mode?: 'date' | 'time';
  date?: string;
  range?: { start: string; end: string };
};

function parseTaskSchedule(extraData: string | null): TaskScheduleMeta | null {
  if (!extraData) return null;
  try {
    const parsed = JSON.parse(extraData) as { schedule?: TaskScheduleMeta };
    return parsed?.schedule ?? null;
  } catch {
    return null;
  }
}

function formatScheduleDateToYMD(value: string): string {
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return t.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseTaskExtraData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
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

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addLocalDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** 含 `d` 的周的周一 0:00（本地） */
function mondayOfWeekContaining(d: Date): Date {
  const sod = startOfLocalDay(d);
  const dow = sod.getDay();
  const deltaMon = dow === 0 ? -6 : 1 - dow;
  return addLocalDays(sod, deltaMon);
}

function ymdToLocalDate(ymd: string): Date | null {
  const t = ymd.trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null;
  return new Date(y, mo - 1, day);
}

function addDaysToYmd(ymd: string, days: number): string {
  const base = ymdToLocalDate(ymd);
  if (!base) return ymd;
  return formatLocalYmd(addLocalDays(base, days));
}

function weekEndSundayYmd(now: Date): string {
  const mon = mondayOfWeekContaining(now);
  const sun = addLocalDays(mon, 6);
  return formatLocalYmd(sun);
}

function parseDueDateAsLocalMoment(dueDate: string): { date: Date; isAllDay: boolean } | null {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (ymd.test(dueDate)) {
    const [yStr, mStr, dStr] = dueDate.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const d = Number(dStr);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    const endOfDay = new Date(y, m - 1, d, 23, 59, 59, 999);
    if (Number.isNaN(endOfDay.getTime())) return null;
    return { date: endOfDay, isAllDay: true };
  }

  const dt = new Date(dueDate);
  if (Number.isNaN(dt.getTime())) return null;
  return { date: dt, isAllDay: false };
}

function formatDueSubtitle(dueDate: string, now: Date) {
  const parsed = parseDueDateAsLocalMoment(dueDate);
  if (!parsed) return '时间格式异常';
  if (!isSameLocalDay(parsed.date, now)) return '时间格式异常';
  if (parsed.isAllDay) return now.getTime() > parsed.date.getTime() ? '今日 全天 已过期' : '今日 全天';
  const hh = String(parsed.date.getHours()).padStart(2, '0');
  const mm = String(parsed.date.getMinutes()).padStart(2, '0');
  return now.getTime() > parsed.date.getTime() ? `今日 ${hh}:${mm} 已过期` : `今日 ${hh}:${mm}`;
}

function getTaskDueDayYmdFromDueDate(t: TaskRow): string | null {
  if (!t.due_date?.trim()) return null;
  if (!isValidDate(t.due_date)) return null;
  const parsed = parseDueDateAsLocalMoment(t.due_date);
  if (!parsed) return null;
  return formatLocalYmd(parsed.date);
}

type FrogPlacement = {
  bucket: TimeBucket;
  anchorYmd: string | null;
};

/** 青蛙时间线：截止日期按截止日分组；时段任务在区间内归今日，未开始按开始日，已结束归过期 */
function getFrogPlacement(t: TaskRow, todayYmd: string): FrogPlacement {
  const schedule = parseTaskSchedule(t.extra_data);

  if (schedule?.mode === 'time' && schedule.range?.start && schedule.range?.end) {
    const startYmd = formatScheduleDateToYMD(schedule.range.start);
    const endYmd = formatScheduleDateToYMD(schedule.range.end);
    if (!startYmd || !endYmd) return { bucket: 'nodate', anchorYmd: null };

    if (isLogicalDayInYmdRange(todayYmd, startYmd, endYmd)) {
      return { bucket: 'today', anchorYmd: todayYmd };
    }
    if (todayYmd < startYmd) {
      return { bucket: 'pending', anchorYmd: startYmd };
    }
    return { bucket: 'expired', anchorYmd: endYmd };
  }

  if (schedule?.mode === 'date' && schedule.date) {
    const dateYmd = formatScheduleDateToYMD(schedule.date);
    if (!dateYmd) return { bucket: 'nodate', anchorYmd: null };
    if (todayYmd > dateYmd) return { bucket: 'expired', anchorYmd: dateYmd };
    return { bucket: 'pending', anchorYmd: dateYmd };
  }

  const dueYmd = getTaskDueDayYmdFromDueDate(t);
  if (!dueYmd) return { bucket: 'nodate', anchorYmd: null };
  if (todayYmd > dueYmd) return { bucket: 'expired', anchorYmd: dueYmd };
  return { bucket: 'pending', anchorYmd: dueYmd };
}

function resolveFrogTimeBucket(
  placement: FrogPlacement,
  todayYmd: string,
  soonEndYmd: string,
  weekEndYmd: string,
  sevenEndYmd: string,
): TimeBucket {
  if (placement.bucket === 'expired' || placement.bucket === 'today' || placement.bucket === 'nodate') {
    return placement.bucket;
  }
  return timeBucketForDueYmd(placement.anchorYmd, todayYmd, soonEndYmd, weekEndYmd, sevenEndYmd);
}

function getTaskDueSortMsForFrog(t: TaskRow, todayYmd: string): number | null {
  const { anchorYmd } = getFrogPlacement(t, todayYmd);
  if (anchorYmd) {
    const d = ymdToLocalDate(anchorYmd);
    if (d) return d.getTime();
  }
  if (!t.due_date?.trim() || !isValidDate(t.due_date)) return null;
  const parsed = parseDueDateAsLocalMoment(t.due_date);
  return parsed ? parsed.date.getTime() : null;
}

/** 与任务 Tab「待办」一致：无项目且无父任务的独立待办不作为今日青蛙候选 */
function isStandaloneTodoTask(t: TaskRow): boolean {
  return !t.project_id && !t.parent_task_id;
}

function formatDueCaption(dueDate: string, now: Date): string {
  const parsed = parseDueDateAsLocalMoment(dueDate);
  if (!parsed) return '截止时间异常';
  const dueYmd = formatLocalYmd(parsed.date);
  const todayStart = startOfLocalDay(now).getTime();
  const dueStart = startOfLocalDay(parsed.date).getTime();
  const diffDays = Math.round((dueStart - todayStart) / 86400000);

  if (diffDays < 0) {
    if (parsed.isAllDay) return `已逾期 · ${dueYmd}`;
    const hh = String(parsed.date.getHours()).padStart(2, '0');
    const mm = String(parsed.date.getMinutes()).padStart(2, '0');
    return `已逾期 · ${dueYmd} ${hh}:${mm}`;
  }
  if (diffDays === 0) return formatDueSubtitle(dueDate, now);
  if (diffDays === 1) return parsed.isAllDay ? '明日 全天' : `明日 ${String(parsed.date.getHours()).padStart(2, '0')}:${String(parsed.date.getMinutes()).padStart(2, '0')}`;
  if (diffDays === 2) return parsed.isAllDay ? '后天 全天' : `后天 ${String(parsed.date.getHours()).padStart(2, '0')}:${String(parsed.date.getMinutes()).padStart(2, '0')}`;
  const m = dueYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `截止 ${Number(m[2])}月${Number(m[3])}日`;
  return `截止 ${dueYmd}`;
}

type TimeBucket = 'expired' | 'today' | 'soon' | 'week' | 'seven' | 'later' | 'nodate' | 'pending';

function timeBucketForDueYmd(
  dueYmd: string | null,
  todayYmd: string,
  soonEndYmd: string,
  weekEndYmd: string,
  sevenEndYmd: string,
): TimeBucket {
  if (!dueYmd) return 'nodate';
  if (dueYmd < todayYmd) return 'expired';
  if (dueYmd === todayYmd) return 'today';
  if (dueYmd <= soonEndYmd) return 'soon';
  if (dueYmd <= weekEndYmd) return 'week';
  if (dueYmd <= sevenEndYmd) return 'seven';
  return 'later';
}

function getTaskContextLabels(
  t: TaskRow,
  taskTitleById: Map<string, string>,
  projectNameById: Record<string, string>,
): { parentLabel: string | null; projectLabel: string | null } {
  const parentLabel = t.parent_task_id
    ? `上级任务：${taskTitleById.get(t.parent_task_id) ?? '（未找到）'}`
    : null;
  const projectName = t.project_id ? projectNameById[t.project_id] : null;
  const projectLabel = projectName ? `所属项目：${projectName}` : null;
  return { parentLabel, projectLabel };
}

function groupTasksToSections(
  rows: TaskRow[],
  now: Date,
  todayYmd: string,
  lockedProjectIds: Set<string>,
  projectNameById: Record<string, string>,
): { sections: Section[]; assignedToday: Item[] } {
  const taskTitleById = new Map(rows.map((r) => [r.id, r.title]));
  const soonEndYmd = addDaysToYmd(todayYmd, 3);
  const weekEndYmd = weekEndSundayYmd(now);
  const sevenEndYmd = addDaysToYmd(todayYmd, 7);

  const hasUnfinishedChild = new Set<string>();
  rows.forEach((t) => {
    if (!t.parent_task_id) return;
    if (t.status === 'done' || t.status === 'cancelled') return;
    hasUnfinishedChild.add(t.parent_task_id);
  });

  const eligible = rows
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .filter((t) => !isStandaloneTodoTask(t))
    .filter((t) => !t.project_id || !lockedProjectIds.has(t.project_id))
    .filter((t) => !hasUnfinishedChild.has(t.id))
    .filter((t) => {
      const extra = parseTaskExtraData(t.extra_data);
      const assignedOn = typeof extra.frogAssignedOn === 'string' ? extra.frogAssignedOn : '';
      return assignedOn !== todayYmd;
    });

  const secExpired: Item[] = [];
  const secToday: Item[] = [];
  const secSoon: Item[] = [];
  const secWeek: Item[] = [];
  const secSeven: Item[] = [];
  const secLater: Item[] = [];
  const secNodate: Item[] = [];

  eligible.forEach((t) => {
    const tone: Item['tone'] = t.priority >= 4 ? 'error' : t.priority === 2 ? 'primary' : t.priority === 3 ? 'tertiary' : 'outline';
    const placement = getFrogPlacement(t, todayYmd);
    const bucket = resolveFrogTimeBucket(placement, todayYmd, soonEndYmd, weekEndYmd, sevenEndYmd);

    const anchorYmd = placement.anchorYmd;
    const dueSortKey = getTaskDueSortMsForFrog(t, todayYmd);
    const schedule = parseTaskSchedule(t.extra_data);
    const inTimeRangeToday =
      schedule?.mode === 'time' &&
      schedule.range?.start &&
      schedule.range?.end &&
      bucket === 'today' &&
      isLogicalDayInYmdRange(
        todayYmd,
        formatScheduleDateToYMD(schedule.range.start),
        formatScheduleDateToYMD(schedule.range.end),
      );

    let subtitle: string;
    if (bucket === 'nodate' || !anchorYmd) {
      subtitle = '未设置截止日期';
    } else if (inTimeRangeToday && schedule?.range?.start && schedule.range.end) {
      const startYmd = formatScheduleDateToYMD(schedule.range.start);
      const endYmd = formatScheduleDateToYMD(schedule.range.end);
      subtitle = startYmd === endYmd ? `时段 · ${startYmd}` : `时段 · ${startYmd} ~ ${endYmd}`;
    } else {
      subtitle = formatDueCaption(anchorYmd, now);
    }

    const { parentLabel, projectLabel } = getTaskContextLabels(t, taskTitleById, projectNameById);

    const item: Item = {
      id: t.id,
      title: t.title,
      parentLabel,
      projectLabel,
      subtitle,
      tone,
      dueSortKey,
      priority: t.priority,
    };

    if (bucket === 'expired') secExpired.push(item);
    else if (bucket === 'today') secToday.push(item);
    else if (bucket === 'soon') secSoon.push(item);
    else if (bucket === 'week') secWeek.push(item);
    else if (bucket === 'seven') secSeven.push(item);
    else if (bucket === 'later') secLater.push(item);
    else secNodate.push(item);
  });

  const sortDated = (a: Item, b: Item) => {
    const ak = a.dueSortKey ?? Number.POSITIVE_INFINITY;
    const bk = b.dueSortKey ?? Number.POSITIVE_INFINITY;
    if (ak !== bk) return ak - bk;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  };

  const sortNodate = (a: Item, b: Item) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.id.localeCompare(b.id);
  };

  secExpired.sort(sortDated);
  secToday.sort(sortDated);
  secSoon.sort(sortDated);
  secWeek.sort(sortDated);
  secSeven.sort(sortDated);
  secLater.sort(sortDated);
  secNodate.sort(sortNodate);

  const sections: Section[] = [];
  if (secExpired.length > 0) {
    sections.push({
      key: 'expired',
      title: '过期',
      badge: '需尽快处理',
      tone: 'error',
      items: secExpired,
      emphasize: true,
    });
  }
  sections.push(
    { key: 'today', title: '今日', badge: '今日到期', tone: 'error', items: secToday },
    { key: 'soon', title: '近三天', badge: '截止较近', tone: 'primary', items: secSoon },
    { key: 'week', title: '本周', badge: '本周末前', tone: 'tertiary', items: secWeek },
    { key: 'seven', title: '近七天', badge: '今起7日内', tone: 'outline', items: secSeven },
    { key: 'later', title: '更晚', badge: '7日之后', tone: 'outline', items: secLater },
    { key: 'nodate', title: '无截止日期', badge: '可选', tone: 'outline', items: secNodate },
  );

  return { sections, assignedToday: buildAssignedTodayItems(rows, todayYmd, taskTitleById, projectNameById) };
}

function buildAssignedTodayItems(
  rows: TaskRow[],
  assignYmd: string,
  taskTitleById: Map<string, string>,
  projectNameById: Record<string, string>,
  isTomorrowTarget = false,
): Item[] {
  return rows
    .filter((t) => getFrogAssignedOn(t.extra_data) === assignYmd)
    .map((t) => {
      const tone: Item['tone'] = t.priority >= 4 ? 'error' : t.priority === 2 ? 'primary' : t.priority === 3 ? 'tertiary' : 'outline';
      const { parentLabel, projectLabel } = getTaskContextLabels(t, taskTitleById, projectNameById);
      return {
        id: t.id,
        title: t.title,
        parentLabel,
        projectLabel,
        subtitle:
          t.status === 'done' || t.status === 'cancelled'
            ? '已完成或已取消'
            : isTomorrowTarget
              ? '明日已预定'
              : '今日已指派',
        tone,
        dueSortKey: null,
        priority: t.priority,
      };
    })
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.id.localeCompare(b.id);
    });
}

const PAGE_API_KEY = 'add-frog';

type FrogAssignTarget = 'today' | 'tomorrow';

function parseFrogAssignTarget(raw: string | string[] | undefined): FrogAssignTarget {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'tomorrow' ? 'tomorrow' : 'today';
}

export default function AddFrogScreen() {
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_API_KEY);
  const { target: targetParam } = useLocalSearchParams<{ target?: string | string[] }>();
  const assignTarget = parseFrogAssignTarget(targetParam);
  const isTomorrowTarget = assignTarget === 'tomorrow';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [sections, setSections] = React.useState<Section[]>(() =>
    groupTasksToSections([], new Date(), getLogicalLocalYmd(new Date(), DEFAULT_TASKS_DAY_BOUNDARY), new Set(), {}).sections,
  );
  const [assignedToday, setAssignedToday] = React.useState<Item[]>(() =>
    groupTasksToSections([], new Date(), getLogicalLocalYmd(new Date(), DEFAULT_TASKS_DAY_BOUNDARY), new Set(), {}).assignedToday,
  );
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [taskMap, setTaskMap] = React.useState<Record<string, TaskRow>>({});
  const [lockedProjectIds, setLockedProjectIds] = React.useState<Set<string>>(() => new Set());

  const reload = React.useCallback(async (forceApi = false) => {
    setLoading(true);
    try {
      await wrapLoad(async () => {
        try {
          const [rows, projectRows, todayFrogResult] = await Promise.all([
            getTasks(),
            getProjects(),
            fetchTodayFrogs({ offlineFallback: true }),
          ]);
      const treeMap: Record<string, TaskTreeNode[]> = {};
      await Promise.all(
        projectRows.map(async (p) => {
          treeMap[p.id] = await getTasksByProjectId(p.id);
        }),
      );
      const now = new Date();
      const boundary = await loadTasksDayBoundary();
      const todayYmd = todayFrogResult.logicalToday || getLogicalLocalYmd(now, boundary);
      const assignYmd = isTomorrowTarget ? addDaysToLogicalYmd(todayYmd, 1) : todayYmd;
      const anchorNow = isTomorrowTarget ? logicalYmdToLocalDate(assignYmd) : now;
      const lockMap = buildProjectLockMap(projectRows, treeMap, todayYmd);
      const locked = new Set<string>();
      lockMap.forEach((info, id) => {
        if (info.locked) locked.add(id);
      });
      setTaskMap(Object.fromEntries(rows.map((r) => [r.id, r])));
      setLockedProjectIds(locked);
      const projectNameById = Object.fromEntries(projectRows.map((p) => [p.id, p.name]));
      const taskTitleById = new Map(rows.map((r) => [r.id, r.title]));
      const grouped = groupTasksToSections(rows, anchorNow, assignYmd, locked, projectNameById);
      setSections(grouped.sections);
      const assignedRows = isTomorrowTarget ? rows : todayFrogResult.tasks;
      setAssignedToday(buildAssignedTodayItems(assignedRows, assignYmd, taskTitleById, projectNameById, isTomorrowTarget));
      setSelected((prev) => {
        const allowed = new Set(rows.filter((r) => !isStandaloneTodoTask(r)).map((r) => r.id));
        const next: Record<string, boolean> = {};
        Object.keys(prev).forEach((k) => {
          if (allowed.has(k) && prev[k]) next[k] = true;
        });
        return next;
      });
        } catch (e) {
          console.warn('加载青蛙候选任务失败', e);
          const empty = groupTasksToSections([], new Date(), getLogicalLocalYmd(new Date(), DEFAULT_TASKS_DAY_BOUNDARY), new Set(), {});
          setSections(empty.sections);
          setAssignedToday(empty.assignedToday);
          setSelected({});
          setTaskMap({});
          setLockedProjectIds(new Set());
        }
      }, forceApi);
    } finally {
      setLoading(false);
    }
  }, [isTomorrowTarget, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload])
  );

  const surface = theme.background;
  const card = theme.surface;
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.28)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(100,116,139,0.7)';
  const blue = isDark ? '#60a5fa' : '#1d4ed8';
  const error = isDark ? '#f87171' : '#ba1a1a';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const tertiary = isDark ? '#fbbf24' : '#825100';

  const getTone = (tone: Item['tone']) => {
    if (tone === 'error') return error;
    if (tone === 'tertiary') return tertiary;
    if (tone === 'outline') return outline;
    return primary;
  };

  const toggle = (id: string) => {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const selectedIds = React.useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);
  const hasAnyCandidates = React.useMemo(() => sections.some((s) => s.items.length > 0), [sections]);

  const unassignFrog = React.useCallback(
    (id: string) => {
      const row = taskMap[id];
      const titleLabel = (row?.title ?? '').trim() || '该任务';
      Alert.alert('取消指派', `确定将「${titleLabel}」从${isTomorrowTarget ? '明日' : '今日'}青蛙中移除吗？`, [
        { text: '保留', style: 'cancel' },
        {
          text: '取消指派',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (!row) return;
              setSaving(true);
              try {
                await unassignFrogFromApi(id, row.extra_data, row as Record<string, unknown>);
                notifyAncestorsDataChanged();
                await reload(true);
              } catch (e) {
                console.warn('取消青蛙指派失败', e);
                const detail =
                  e instanceof ApiRequestError
                    ? e.message
                    : e instanceof Error
                      ? e.message.trim()
                      : '';
                Alert.alert('操作失败', detail || '未能取消指派，请检查网络后重试。');
              } finally {
                setSaving(false);
              }
            })();
          },
        },
      ]);
    },
    [isTomorrowTarget, notifyAncestorsDataChanged, reload, taskMap]
  );

  const assignFrogs = React.useCallback(async () => {
    if (saving || selectedIds.length === 0) return;
    setSaving(true);
    try {
      const boundary = await loadTasksDayBoundary();
      const todayYmd = getLogicalLocalYmd(new Date(), boundary);
      const assignYmd = isTomorrowTarget ? addDaysToLogicalYmd(todayYmd, 1) : todayYmd;
      const ids = selectedIds.slice();
      const lockedPick = ids.find((id) => {
        const row = taskMap[id];
        return row?.project_id && lockedProjectIds.has(row.project_id);
      });
      if (lockedPick) {
        Alert.alert('无法指派', '所选任务所属项目仍被前置项目锁定，请先完成前置项目。');
        return;
      }
      for (const id of ids) {
        const row = taskMap[id];
        if (!row) {
          throw new Error('任务数据已过期，请下拉刷新后重试');
        }
        await assignFrogToApi(id, row.extra_data ?? null, assignYmd, row as Record<string, unknown>);
      }
      Alert.alert(
        isTomorrowTarget ? '已预定' : '已指派',
        isTomorrowTarget
          ? `已将 ${ids.length} 个任务预定为明日青蛙。`
          : `已将 ${ids.length} 个任务指派为今日青蛙。`,
      );
      notifyAncestorsDataChanged();
      router.back();
    } catch (e) {
      console.warn('指派青蛙失败', e);
      const detail =
        e instanceof ApiRequestError
          ? e.message
          : e instanceof Error
            ? e.message.trim()
            : '';
      Alert.alert('指派失败', detail || '未能保存青蛙指派状态，请检查网络后重试。');
    } finally {
      setSaving(false);
    }
  }, [isTomorrowTarget, lockedProjectIds, notifyAncestorsDataChanged, router, saving, selectedIds, taskMap]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: surface }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)',
            borderBottomColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
          },
        ]}>
        <View style={styles.headerLeft}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="arrow-back" size={22} color={blue} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: blue }]}>{isTomorrowTarget ? '预定青蛙' : '新增青蛙'}</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 140 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.editorial}>
          <Text style={[styles.kicker, { color: primary }]}>{isTomorrowTarget ? '明日' : '时间线'}</Text>
          <Text style={[styles.h1, { color: theme.text }]}>{isTomorrowTarget ? '选择明日青蛙' : '选择青蛙'}</Text>
        </View>

        <View style={styles.sections}>
          {assignedToday.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionHeaderLeft}>
                  <View style={[styles.sectionBar, { backgroundColor: primary }]} />
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>
                    {isTomorrowTarget ? '明日已预定' : '今日已指派'}
                  </Text>
                </View>
                <View style={[styles.sectionBadge, { backgroundColor: `${primary}1A` }]}>
                  <Text style={[styles.sectionBadgeText, { color: primary }]}>{assignedToday.length} 条</Text>
                </View>
              </View>
              <View style={styles.items}>
                {assignedToday.map((it) => (
                  <View
                    key={it.id}
                    style={[styles.item, { backgroundColor: card, borderColor: outlineVariant }]}>
                    <View style={styles.itemLeft}>
                      <Pressable
                        onPress={() => unassignFrog(it.id)}
                        hitSlop={8}
                        disabled={saving}
                        style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
                        <View style={[styles.checkbox, { backgroundColor: `${primary}22`, borderColor: primary }]}>
                          <MaterialIcons name="link-off" size={16} color={primary} />
                        </View>
                      </Pressable>
                      <Pressable
                        style={({ pressed }) => [styles.itemText, pressed && { opacity: 0.82 }]}
                        onPress={() =>
                          router.push(
                            !it.parentLabel && !it.projectLabel
                              ? standaloneTodoEditorHref(it.id)
                              : { pathname: '/task/[id]', params: { id: it.id } },
                          )
                        }>
                        <Text style={[styles.itemTitle, { color: theme.text }]}>{it.title}</Text>
                        {it.parentLabel ? (
                          <Text style={[styles.itemContextHint, { color: outline }]} numberOfLines={1}>
                            {it.parentLabel}
                          </Text>
                        ) : null}
                        {it.projectLabel ? (
                          <Text style={[styles.itemContextHint, { color: outline }]} numberOfLines={1}>
                            {it.projectLabel}
                          </Text>
                        ) : null}
                        <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>{it.subtitle}</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
              <Text style={[styles.assignedHint, { color: theme.textSecondary }]}>
                点击左侧图标可取消指派；取消后可重新在下方选择。
              </Text>
            </View>
          ) : null}
          {!hasAnyCandidates ? (
            <View style={[styles.section, { opacity: 0.85 }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>暂无可选青蛙</Text>
              <Text style={[styles.itemSubtitle, { color: theme.textSecondary, marginTop: 8 }]}>
                可选范围：已过期任务、今日到期/时段内、今起三天内、本周日内、近七天内、更晚的已设日期任务，或未设置截止日期的任务。请先在任务中设置截止时间，或稍后再试。
              </Text>
            </View>
          ) : null}
          {sections.map((sec) => {
            const secColor = getTone(sec.tone);
            const badgeBg =
              sec.tone === 'error'
                ? `${error}1A`
                : sec.tone === 'outline'
                  ? isDark
                    ? 'rgba(148,163,184,0.12)'
                    : 'rgba(148,163,184,0.18)'
                  : `${secColor}1A`;

            return (
              <View key={sec.key} style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionHeaderLeft}>
                    <View
                      style={[
                        styles.sectionBar,
                        { backgroundColor: sec.emphasize ? error : secColor },
                        sec.emphasize && { height: 30 },
                      ]}
                    />
                    <Text
                      style={[
                        styles.sectionTitle,
                        sec.emphasize
                          ? { color: error, fontWeight: '900' }
                          : { color: sec.tone === 'outline' && sec.key !== 'nodate' ? theme.textSecondary : theme.text },
                      ]}>
                      {sec.title}
                    </Text>
                  </View>
                  <View style={[styles.sectionBadge, { backgroundColor: badgeBg }]}>
                    <Text style={[styles.sectionBadgeText, { color: secColor }]}>{sec.badge}</Text>
                  </View>
                </View>

                <View style={styles.items}>
                  {sec.items.length === 0 ? (
                    <View style={[styles.item, { backgroundColor: card, borderColor: outlineVariant, opacity: 0.7 }]}>
                      <View style={styles.itemLeft}>
                        <View style={[styles.checkbox, { backgroundColor: 'transparent', borderColor: outlineVariant }]} />
                        <View style={styles.itemText}>
                          <Text style={[styles.itemTitle, { color: theme.textSecondary }]}>暂无任务</Text>
                          <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>
                            {sec.key === 'expired'
                              ? '没有已过期的待办'
                              : sec.key === 'today'
                              ? '没有今日到期或处于时段内的待办'
                              : sec.key === 'soon'
                                ? '没有截止日在近三天内的待办'
                                : sec.key === 'week'
                                  ? '没有仍在本周末前、且不属于近三天的待办'
                                  : sec.key === 'seven'
                                    ? '没有落在「本周结束之后、今起7天内」的待办'
                                    : sec.key === 'later'
                                      ? '没有截止日在7天之后的待办'
                                      : '没有未设置截止日期的待办'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  ) : null}
                  {sec.items.map((it) => {
                    const checked = !!selected[it.id];
                    const toneColor = getTone(it.tone);
                    const boxBg = checked ? toneColor : 'transparent';
                    const boxBorder = checked ? toneColor : outlineVariant;
                    const titleColor =
                      sec.tone === 'outline' && sec.key !== 'nodate' ? theme.textSecondary : theme.text;
                    const hoverColor = checked ? toneColor : titleColor;

                    return (
                      <View
                        key={it.id}
                        style={[styles.item, { backgroundColor: card, borderColor: outlineVariant }]}>
                        <View style={styles.itemLeft}>
                          <Pressable
                            onPress={() => toggle(it.id)}
                            hitSlop={8}
                            style={({ pressed }) => [pressed && { opacity: 0.75 }]}>
                            <View style={[styles.checkbox, { backgroundColor: boxBg, borderColor: boxBorder }]}>
                              {checked ? <MaterialIcons name="check" size={16} color="#fff" /> : null}
                            </View>
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [styles.itemText, pressed && { opacity: 0.82 }]}
                            onPress={() =>
                              router.push(
                                !it.parentLabel && !it.projectLabel
                                  ? standaloneTodoEditorHref(it.id)
                                  : { pathname: '/task/[id]', params: { id: it.id } },
                              )
                            }>
                            <Text style={[styles.itemTitle, { color: checked ? hoverColor : titleColor }]}>{it.title}</Text>
                            {it.parentLabel ? (
                              <Text style={[styles.itemContextHint, { color: outline }]} numberOfLines={1}>
                                {it.parentLabel}
                              </Text>
                            ) : null}
                            {it.projectLabel ? (
                              <Text style={[styles.itemContextHint, { color: outline }]} numberOfLines={1}>
                                {it.projectLabel}
                              </Text>
                            ) : null}
                            {it.subtitle ? (
                              <Text style={[styles.itemSubtitle, { color: theme.textSecondary }]}>{it.subtitle}</Text>
                            ) : null}
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: Math.max(insets.bottom, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.65)' : 'rgba(255,255,255,0.65)',
            borderTopColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
          },
        ]}>
        <View style={styles.bottomBarInner}>
          <Pressable
            onPress={assignFrogs}
            disabled={selectedIds.length === 0 || saving || loading}
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                opacity: selectedIds.length === 0 || saving || loading ? 0.55 : pressed ? 0.92 : 1,
                backgroundColor: selectedIds.length === 0 || saving || loading ? `${primary}80` : primary,
              },
              pressed && selectedIds.length > 0 && !saving && !loading && { transform: [{ scale: 0.98 }] },
            ]}>
            <Text style={styles.confirmText}>
              {saving ? (isTomorrowTarget ? '预定中…' : '指派中…') : isTomorrowTarget ? '确认预定' : '确认指派'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
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
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  content: {
    paddingTop: 92,
    paddingHorizontal: 18,
    gap: 18,
  },
  editorial: {
    gap: 10,
    paddingBottom: 8,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  h1: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
    lineHeight: 46,
  },
  sections: {
    gap: 18,
  },
  section: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sectionBar: {
    width: 6,
    height: 26,
    borderRadius: 6,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  sectionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  items: {
    gap: 10,
  },
  item: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemText: {
    flex: 1,
    gap: 6,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  itemContextHint: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.7,
    letterSpacing: 0.2,
  },
  itemSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  assignedHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    paddingHorizontal: 2,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  bottomBarInner: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  confirmBtn: {
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
  confirmText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
});

