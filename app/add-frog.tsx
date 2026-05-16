import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { DEFAULT_TASKS_DAY_BOUNDARY, getLogicalLocalYmd, loadTasksDayBoundary } from '@/lib/tasks-logical-day';
import { getTasks, updateTask } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Item = {
  id: string;
  title: string;
  subtitle: string;
  tone: 'error' | 'primary' | 'tertiary' | 'outline';
  /** 有截止日期时用于组内排序：时间戳升序；无日期为 null */
  dueSortKey: number | null;
  priority: number;
};

type Section = { key: string; title: string; badge: string; tone: Item['tone']; items: Item[] };

type FrogTaskMeta = {
  frogAssignedOn?: string;
};

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

function getTaskDueDayYmd(t: TaskRow): string | null {
  if (!t.due_date?.trim()) return null;
  if (!isValidDate(t.due_date)) return null;
  const parsed = parseDueDateAsLocalMoment(t.due_date);
  if (!parsed) return null;
  return formatLocalYmd(parsed.date);
}

function getTaskDueSortMs(t: TaskRow): number | null {
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

type TimeBucket = 'today' | 'soon' | 'week' | 'seven' | 'nodate' | 'exclude';

function timeBucketForDueYmd(
  dueYmd: string | null,
  todayYmd: string,
  soonEndYmd: string,
  weekEndYmd: string,
  sevenEndYmd: string,
): TimeBucket {
  if (!dueYmd) return 'nodate';
  if (dueYmd <= todayYmd) return 'today';
  if (dueYmd <= soonEndYmd) return 'soon';
  if (dueYmd <= weekEndYmd) return 'week';
  if (dueYmd <= sevenEndYmd) return 'seven';
  return 'exclude';
}

function groupTasksToSections(rows: TaskRow[], now: Date, todayYmd: string): Section[] {
  const soonEndYmd = addDaysToYmd(todayYmd, 3);
  const weekEndYmd = weekEndSundayYmd(now);
  const sevenEndYmd = addDaysToYmd(todayYmd, 7);
  const lastIncludedYmd = [soonEndYmd, weekEndYmd, sevenEndYmd].reduce((m, x) => (x > m ? x : m), soonEndYmd);

  const hasUnfinishedChild = new Set<string>();
  rows.forEach((t) => {
    if (!t.parent_task_id) return;
    if (t.status === 'done' || t.status === 'cancelled') return;
    hasUnfinishedChild.add(t.parent_task_id);
  });

  const eligible = rows
    .filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    .filter((t) => !isStandaloneTodoTask(t))
    .filter((t) => !hasUnfinishedChild.has(t.id))
    .filter((t) => {
      const extra = parseTaskExtraData(t.extra_data);
      const assignedOn = typeof extra.frogAssignedOn === 'string' ? extra.frogAssignedOn : '';
      return assignedOn !== todayYmd;
    })
    .filter((t) => {
      const dueYmd = getTaskDueDayYmd(t);
      if (!t.due_date?.trim()) return true;
      if (!dueYmd) return true;
      return dueYmd <= lastIncludedYmd;
    });

  const secToday: Item[] = [];
  const secSoon: Item[] = [];
  const secWeek: Item[] = [];
  const secSeven: Item[] = [];
  const secNodate: Item[] = [];

  eligible.forEach((t) => {
    const tone: Item['tone'] = t.priority >= 4 ? 'error' : t.priority === 2 ? 'primary' : t.priority === 3 ? 'tertiary' : 'outline';
    const dueYmd = getTaskDueDayYmd(t);
    const bucket = timeBucketForDueYmd(dueYmd, todayYmd, soonEndYmd, weekEndYmd, sevenEndYmd);
    if (bucket === 'exclude') return;

    const dueSortKey = getTaskDueSortMs(t);
    const subtitle =
      bucket === 'nodate' || !t.due_date?.trim()
        ? '未设置截止日期'
        : t.due_date && isValidDate(t.due_date)
          ? formatDueCaption(t.due_date, now)
          : '未设置截止日期';

    const item: Item = {
      id: t.id,
      title: t.title,
      subtitle,
      tone,
      dueSortKey,
      priority: t.priority,
    };

    if (bucket === 'today') secToday.push(item);
    else if (bucket === 'soon') secSoon.push(item);
    else if (bucket === 'week') secWeek.push(item);
    else if (bucket === 'seven') secSeven.push(item);
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

  secToday.sort(sortDated);
  secSoon.sort(sortDated);
  secWeek.sort(sortDated);
  secSeven.sort(sortDated);
  secNodate.sort(sortNodate);

  return [
    { key: 'today', title: '今日', badge: '含已逾期', tone: 'error', items: secToday },
    { key: 'soon', title: '近三天', badge: '截止较近', tone: 'primary', items: secSoon },
    { key: 'week', title: '本周', badge: '本周末前', tone: 'tertiary', items: secWeek },
    { key: 'seven', title: '近七天', badge: '今起7日内', tone: 'outline', items: secSeven },
    { key: 'nodate', title: '无截止日期', badge: '可选', tone: 'outline', items: secNodate },
  ];
}

export default function AddFrogScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [sections, setSections] = React.useState<Section[]>(() =>
    groupTasksToSections([], new Date(), getLogicalLocalYmd(new Date(), DEFAULT_TASKS_DAY_BOUNDARY)),
  );
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [taskMap, setTaskMap] = React.useState<Record<string, TaskRow>>({});

  const loadEligibleTasks = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getTasks();
      const now = new Date();
      const boundary = await loadTasksDayBoundary();
      const todayYmd = getLogicalLocalYmd(now, boundary);
      setTaskMap(Object.fromEntries(rows.map((r) => [r.id, r])));
      setSections(groupTasksToSections(rows, now, todayYmd));
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
      setSections(groupTasksToSections([], new Date(), getLogicalLocalYmd(new Date(), DEFAULT_TASKS_DAY_BOUNDARY)));
      setSelected({});
      setTaskMap({});
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void loadEligibleTasks();
    }, [loadEligibleTasks])
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

  const assignFrogs = React.useCallback(async () => {
    if (saving || selectedIds.length === 0) return;
    setSaving(true);
    try {
      const boundary = await loadTasksDayBoundary();
      const today = getLogicalLocalYmd(new Date(), boundary);
      const ids = selectedIds.slice();
      await Promise.all(
        ids.map(async (id) => {
          const row = taskMap[id];
          const currentExtra = parseTaskExtraData(row?.extra_data ?? null);
          const nextExtra: FrogTaskMeta & Record<string, unknown> = {
            ...currentExtra,
            frogAssignedOn: today,
          };
          await updateTask(id, { extra_data: JSON.stringify(nextExtra) });
        })
      );
      Alert.alert('已指派', `已将 ${ids.length} 个任务指派为今日青蛙。`);
      router.back();
    } catch (e) {
      console.warn('指派青蛙失败', e);
      Alert.alert('指派失败', '未能保存青蛙指派状态，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }, [router, saving, selectedIds, taskMap]);

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
          <Text style={[styles.headerTitle, { color: blue }]}>新增青蛙</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 140 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.editorial}>
          <Text style={[styles.kicker, { color: primary }]}>时间线</Text>
          <Text style={[styles.h1, { color: theme.text }]}>选择青蛙</Text>
        </View>

        <View style={styles.sections}>
          {!hasAnyCandidates ? (
            <View style={[styles.section, { opacity: 0.85 }]}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>暂无可选青蛙</Text>
              <Text style={[styles.itemSubtitle, { color: theme.textSecondary, marginTop: 8 }]}>
                可选范围：今日（含已逾期）、今起三天内、本周日内、再往后至「今起第7天」内的任务，或未设置截止日期的任务。请先在任务中设置截止时间，或稍后再试。
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
                    <View style={[styles.sectionBar, { backgroundColor: secColor }]} />
                    <Text
                      style={[
                        styles.sectionTitle,
                        { color: sec.tone === 'outline' && sec.key !== 'nodate' ? theme.textSecondary : theme.text },
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
                            {sec.key === 'today'
                              ? '没有今日或已逾期的待办'
                              : sec.key === 'soon'
                                ? '没有截止日在近三天内的待办'
                                : sec.key === 'week'
                                  ? '没有仍在本周末前、且不属于近三天的待办'
                                  : sec.key === 'seven'
                                    ? '没有落在「本周结束之后、今起7天内」的待办'
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
                            onPress={() => router.push({ pathname: '/task/[id]', params: { id: it.id } })}>
                            <Text style={[styles.itemTitle, { color: checked ? hoverColor : titleColor }]}>{it.title}</Text>
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
            <Text style={styles.confirmText}>{saving ? '指派中…' : '确认指派'}</Text>
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
  itemSubtitle: {
    fontSize: 12,
    fontWeight: '600',
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

