import { HealthIntakeDeleteConfirmSheet } from '@/components/health/health-intake-delete-confirm-sheet';
import { HealthRiseIn, useHealthMotionGate } from '@/components/health/health-motion';
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { formatStoredDatetimeHm } from '@/lib/api-mysql-datetime';
import { compareDatetimeDesc } from '@/lib/api-read-helpers';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { formatYmd, parseYmd } from '@/lib/date';
import {
  createQuickAddItemMap,
  getQuickAddMetricTypes,
  loadAllQuickAddItems,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import { deleteHealthRecord, getHealthRecordsByUserId } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type FilterKey = 'all' | 'hydration' | 'protein' | 'carbohydrate' | 'calories' | 'photo';
type NutrientKey = Exclude<FilterKey, 'all' | 'photo'>;

const HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY = 'ai_text_intake';
const PAGE_API_KEY = 'intake-history';
const INITIAL_VISIBLE = 12;
const LOAD_MORE_STEP = 12;
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

type IntakeHistoryLine = {
  key: string;
  recordId: string;
  title: string;
  metric: NutrientKey;
  amount: string;
  meta: string;
  time: string;
  ymd: string;
  searchBlob: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  filterCategories: NutrientKey[];
  isPhoto: boolean;
  calories: number;
  iconColor: string;
  iconBg: string;
};

type DayGroup = {
  ymd: string;
  label: string;
  summary: string;
  lines: IntakeHistoryLine[];
};

function recordYmd(row: HealthRecordRow): string {
  const raw = typeof row.record_date === 'string' ? row.record_date.trim() : '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
}

function formatIntakeAmount(value: number, unit: 'ml' | 'g' | 'kcal'): string {
  const formatted = Number(value.toFixed(2)).toString();
  return `${formatted}${unit}`;
}

function formatLocaleNum(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function positiveNutrientKindsCount(row: HealthRecordRow): number {
  return [row.hydration > 0, row.protein > 0, row.carbohydrate > 0, row.calories > 0].filter(Boolean).length;
}

function firstPositiveIntakeMetric(row: HealthRecordRow): NutrientKey {
  if (row.hydration > 0) return 'hydration';
  if (row.protein > 0) return 'protein';
  if (row.carbohydrate > 0) return 'carbohydrate';
  return 'calories';
}

function filterCategoriesForRow(row: HealthRecordRow): NutrientKey[] {
  const out: NutrientKey[] = [];
  if (row.hydration > 0) out.push('hydration');
  if (row.protein > 0) out.push('protein');
  if (row.carbohydrate > 0) out.push('carbohydrate');
  if (row.calories > 0) out.push('calories');
  return out;
}

function resolveSourceTag(row: HealthRecordRow): string {
  if (row.source_image_uri?.trim()) return '拍照';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 文本';
  if (row.quick_add_key) return '快捷卡';
  return '手动';
}

function combinedHistoryTitle(row: HealthRecordRow, quickAddByKey: ReturnType<typeof createQuickAddItemMap>): string {
  const custom = row.intake_display_title?.trim();
  if (custom) return custom;
  if (row.source_image_uri?.trim()) return 'AI 拍照识别';
  if (row.quick_add_key === HEALTH_AI_TEXT_INTAKE_QUICK_ADD_KEY) return 'AI 记录';
  if (!row.quick_add_key && row.hydration === 0) return 'AI 拍照识别';
  const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
  return qa?.label ?? '合并摄入';
}

function singleHistoryLineTitle(row: HealthRecordRow, fallback: string): string {
  return row.intake_display_title?.trim() || fallback;
}

function formatCombinedMeta(row: HealthRecordRow, source: string): string {
  const parts: string[] = [source];
  if (positiveNutrientKindsCount(row) >= 2) {
    parts.push(`合并 ${positiveNutrientKindsCount(row)} 项`);
  }
  if (row.protein > 0) parts.push(`蛋白 ${formatIntakeAmount(row.protein, 'g')}`);
  if (row.calories > 0 && positiveNutrientKindsCount(row) === 1) {
    /* single handled elsewhere */
  } else if (row.calories > 0 && row.protein > 0) {
    parts.push(`热量 ${Math.round(row.calories)}`);
  }
  return parts.join(' · ');
}

function nutrientPrimaryAmount(row: HealthRecordRow, metric: NutrientKey): string {
  if (metric === 'hydration') return formatIntakeAmount(row.hydration, 'ml');
  if (metric === 'protein') return formatIntakeAmount(row.protein, 'g');
  if (metric === 'carbohydrate') return `${formatIntakeAmount(row.carbohydrate, 'g')} 碳水`;
  return `${formatIntakeAmount(row.calories, 'kcal')}`;
}

function primaryDisplayAmount(row: HealthRecordRow): string {
  if (positiveNutrientKindsCount(row) >= 2) {
    if (row.calories > 0) return `${Math.round(row.calories)} kcal`;
    if (row.protein > 0) return formatIntakeAmount(row.protein, 'g');
    if (row.hydration > 0) return formatIntakeAmount(row.hydration, 'ml');
    return formatIntakeAmount(row.carbohydrate, 'g');
  }
  return nutrientPrimaryAmount(row, firstPositiveIntakeMetric(row));
}

function buildHistoryLines(
  rows: HealthRecordRow[],
  quickAddCatalog: QuickAddCardItem[],
  nutrients: { hydration: string; protein: string; carbohydrate: string; calories: string },
): IntakeHistoryLine[] {
  const lines: IntakeHistoryLine[] = [];
  const quickAddByKey = createQuickAddItemMap(quickAddCatalog);
  const includesMetric = (qa: QuickAddCardItem | undefined, metric: NutrientKey) =>
    Boolean(qa && getQuickAddMetricTypes(qa).includes(metric));

  const ordered = [...rows].sort((a, b) => {
    const yd = recordYmd(b).localeCompare(recordYmd(a));
    if (yd !== 0) return yd;
    return compareDatetimeDesc(a.created_at, b.created_at);
  });

  for (const row of ordered) {
    const time = formatStoredDatetimeHm(row.created_at);
    const ymd = recordYmd(row);
    const source = resolveSourceTag(row);
    const ai = row.intake_ai_comment?.trim() ?? '';
    const isPhoto = Boolean(row.source_image_uri?.trim());
    const searchBlob = [row.intake_display_title, ai, source, row.quick_add_key]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (positiveNutrientKindsCount(row) >= 2) {
      const primary = firstPositiveIntakeMetric(row);
      const title = combinedHistoryTitle(row, quickAddByKey);
      lines.push({
        key: `${row.id}-combined`,
        recordId: row.id,
        title,
        metric: primary,
        amount: primaryDisplayAmount(row),
        meta: formatCombinedMeta(row, source),
        time,
        ymd,
        searchBlob: `${searchBlob} ${title}`.toLowerCase(),
        icon: isPhoto ? 'photo-camera' : 'auto-awesome',
        filterCategories: filterCategoriesForRow(row),
        isPhoto,
        calories: Number(row.calories) || 0,
        iconColor: nutrients[primary],
        iconBg: `${nutrients[primary]}22`,
      });
      continue;
    }

    const pushOne = (
      metric: NutrientKey,
      titleFallback: string,
      icon: keyof typeof MaterialIcons.glyphMap,
      amount: string,
      metaExtra: string,
    ) => {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      const title = singleHistoryLineTitle(
        row,
        includesMetric(qa, metric) && qa ? qa.label : titleFallback,
      );
      lines.push({
        key: `${row.id}-${metric[0]}`,
        recordId: row.id,
        title,
        metric,
        amount,
        meta: `${source}${metaExtra ? ` · ${metaExtra}` : ''}`,
        time,
        ymd,
        searchBlob: `${searchBlob} ${title}`.toLowerCase(),
        icon: includesMetric(qa, metric) && qa ? (qa.icon as keyof typeof MaterialIcons.glyphMap) : icon,
        filterCategories: [metric],
        isPhoto,
        calories: Number(row.calories) || 0,
        iconColor: nutrients[metric],
        iconBg: `${nutrients[metric]}22`,
      });
    };

    if (row.hydration > 0) {
      pushOne('hydration', '水分', 'water-drop', formatIntakeAmount(row.hydration, 'ml'), '');
    }
    if (row.protein > 0) {
      pushOne('protein', '蛋白', 'egg', formatIntakeAmount(row.protein, 'g'), `蛋白 ${Math.round(row.protein)}g`);
    }
    if (row.carbohydrate > 0) {
      pushOne(
        'carbohydrate',
        '碳水',
        'grain',
        `${formatIntakeAmount(row.carbohydrate, 'g')} 碳水`,
        `碳水 ${Math.round(row.carbohydrate)}g`,
      );
    }
    if (row.calories > 0) {
      pushOne(
        'calories',
        '热量',
        'local-fire-department',
        `${Math.round(row.calories)} kcal`,
        `热量 ${Math.round(row.calories)}`,
      );
    }
  }
  return lines;
}

function formatDayGroupLabel(ymd: string): string {
  const d = parseYmd(ymd);
  if (!d) return ymd;
  const today = new Date();
  const todayYmd = formatYmd(today);
  const wd = WEEKDAY_CN[d.getDay()];
  if (ymd === todayYmd) return `今天 · ${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wd}`;
}

function groupLinesByDay(lines: IntakeHistoryLine[]): DayGroup[] {
  const map = new Map<string, IntakeHistoryLine[]>();
  for (const line of lines) {
    const bucket = map.get(line.ymd);
    if (bucket) bucket.push(line);
    else map.set(line.ymd, [line]);
  }
  const ymds = [...map.keys()].sort((a, b) => b.localeCompare(a));
  return ymds.map((ymd) => {
    const dayLines = map.get(ymd) ?? [];
    const kcal = dayLines.reduce((s, l) => s + (l.key.includes('-combined') || l.metric === 'calories' ? l.calories : 0), 0);
    /** 同日多行可能重复计热量：按 recordId 去重累加 */
    const seen = new Set<string>();
    let dayKcal = 0;
    for (const l of dayLines) {
      if (seen.has(l.recordId)) continue;
      seen.add(l.recordId);
      dayKcal += l.calories;
    }
    void kcal;
    const uniqueCount = seen.size;
    return {
      ymd,
      label: formatDayGroupLabel(ymd),
      summary: `${uniqueCount} 条 · ${formatLocaleNum(dayKcal)} kcal`,
      lines: dayLines,
    };
  });
}

const FILTERS: {
  key: FilterKey;
  label: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
}[] = [
  { key: 'all', label: '全部' },
  { key: 'hydration', label: '水分', icon: 'water-drop' },
  { key: 'protein', label: '蛋白', icon: 'egg' },
  { key: 'carbohydrate', label: '碳水', icon: 'grain' },
  { key: 'calories', label: '热量', icon: 'local-fire-department' },
  { key: 'photo', label: '拍照', icon: 'photo-camera' },
];

export default function IntakeHistoryScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hh, nutrients } = useHealthHomeTheme();
  const { animate: entranceOn } = useHealthMotionGate();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const focusYmd = React.useMemo(() => {
    const raw = Array.isArray(date) ? date[0] : date;
    if (!raw) return null;
    const d = parseYmd(raw.trim().slice(0, 10));
    return d ? formatYmd(d) : null;
  }, [date]);

  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [query, setQuery] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [lines, setLines] = React.useState<IntakeHistoryLine[]>([]);
  const [visibleCount, setVisibleCount] = React.useState(INITIAL_VISIBLE);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = React.useState<{
    recordId: string;
    title: string;
    detail: string;
    icon: keyof typeof MaterialIcons.glyphMap;
    iconColor: string;
  } | null>(null);
  /** 筛选/搜索变化时重播列表级联入场 */
  const [listAnimKey, setListAnimKey] = React.useState(0);
  const firstPaintRef = React.useRef(true);

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      await wrapLoad(async () => {
        const [user, catalog] = await Promise.all([getDefaultUser(), loadAllQuickAddItems()]);
        if (!user?.id) {
          setLines([]);
          return;
        }
        const records = await getHealthRecordsByUserId(user.id);
        setLines(buildHistoryLines(records, catalog, nutrients));
      }, forceRefresh);
    },
    [nutrients, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  React.useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
    if (firstPaintRef.current) {
      firstPaintRef.current = false;
      setListAnimKey((k) => k + 1);
      return;
    }
    setListAnimKey((k) => k + 1);
  }, [filter, query]);

  const filteredLines = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (filter === 'photo' && !line.isPhoto) return false;
      if (filter !== 'all' && filter !== 'photo' && !line.filterCategories.includes(filter)) return false;
      if (q && !line.searchBlob.includes(q) && !line.title.toLowerCase().includes(q) && !line.meta.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [filter, lines, query]);

  const monthStats = React.useMemo(() => {
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthLines = lines.filter((l) => l.ymd.startsWith(monthPrefix));
    const recordIds = new Set(monthLines.map((l) => l.recordId));
    const photoIds = new Set(monthLines.filter((l) => l.isPhoto).map((l) => l.recordId));
    const dayKcal = new Map<string, number>();
    const seen = new Set<string>();
    for (const l of monthLines) {
      if (seen.has(l.recordId)) continue;
      seen.add(l.recordId);
      dayKcal.set(l.ymd, (dayKcal.get(l.ymd) ?? 0) + l.calories);
    }
    const daysWithKcal = [...dayKcal.values()].filter((v) => v > 0);
    const avgKcal =
      daysWithKcal.length > 0
        ? Math.round(daysWithKcal.reduce((a, b) => a + b, 0) / daysWithKcal.length)
        : 0;
    const photoPct = recordIds.size > 0 ? Math.round((photoIds.size / recordIds.size) * 100) : 0;
    return {
      monthCount: recordIds.size,
      avgKcal,
      photoPct,
      totalCount: new Set(lines.map((l) => l.recordId)).size,
    };
  }, [lines]);

  const visibleLines = filteredLines.slice(0, visibleCount);
  const dayGroups = React.useMemo(() => groupLinesByDay(visibleLines), [visibleLines]);
  const hasMore = visibleCount < filteredLines.length;

  const confirmDelete = React.useCallback(
    (recordId: string) => {
      if (deletingId) return;
      const line = lines.find((l) => l.recordId === recordId);
      setDeleteConfirm({
        recordId,
        title: line?.title ?? '这条记录',
        detail: line ? `${line.time} · ${line.meta}` : '删除后无法恢复',
        icon: line?.icon ?? 'restaurant',
        iconColor: line?.iconColor ?? hh.pine,
      });
    },
    [deletingId, lines, hh.pine],
  );

  const performDelete = React.useCallback(async () => {
    if (!deleteConfirm || deletingId) return;
    const recordId = deleteConfirm.recordId;
    setDeletingId(recordId);
    try {
      await deleteHealthRecord(recordId);
      setLines((prev) => prev.filter((l) => l.recordId !== recordId));
      setDeleteConfirm(null);
      toast.success('已删除');
    } catch (e) {
      toast.error(toUserMessage(e, '删除失败，请稍后重试'));
    } finally {
      setDeletingId(null);
    }
  }, [deleteConfirm, deletingId]);

  const filterIconColor = (key: FilterKey, active: boolean) => {
    if (active) return hh.onPine;
    if (key === 'hydration') return nutrients.hydration;
    if (key === 'protein') return nutrients.protein;
    if (key === 'carbohydrate') return nutrients.carbohydrate;
    if (key === 'calories') return nutrients.calories;
    if (key === 'photo') return hh.pineSoft;
    return hh.muted;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: hh.paper }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top + 4, borderBottomColor: hh.line }]}>
        <Pressable
          style={styles.headerBtn}
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back" size={22} color={hh.ink} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: hh.ink }]} maxFontSizeMultiplier={1.3}>
            摄入历史
          </Text>
          <Text style={[styles.headerSub, { color: hh.muted }]} maxFontSizeMultiplier={1.2}>
            HISTORY · 共 {monthStats.totalCount} 条
          </Text>
        </View>
        <Pressable
          style={styles.headerBtn}
          onPress={() => setSearchOpen((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="搜索">
          <MaterialIcons name="search" size={22} color={hh.ink} />
        </Pressable>
      </View>

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.scroll, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {(searchOpen || query.length > 0) && (
          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: hh.card, borderColor: hh.line }]}>
              <MaterialIcons name="search" size={18} color={hh.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="搜索食物、备注或 AI 评价"
                placeholderTextColor={hh.faint}
                style={[styles.searchInput, { color: hh.ink }]}
                autoFocus={searchOpen && query.length === 0}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            <Pressable
              style={[styles.filterRound, { backgroundColor: hh.card, borderColor: hh.line }]}
              onPress={() => setFilter((f) => (f === 'all' ? 'photo' : 'all'))}
              accessibilityRole="button"
              accessibilityLabel="切换拍照筛选">
              <MaterialIcons name="tune" size={18} color={hh.inkSoft} />
            </Pressable>
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.chipScroll}>
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? hh.pine : hh.card,
                    borderColor: active ? hh.pine : hh.line,
                  },
                ]}>
                {item.icon ? (
                  <MaterialIcons name={item.icon} size={14} color={filterIconColor(item.key, active)} />
                ) : null}
                <Text style={[styles.chipText, { color: active ? hh.onPine : hh.inkSoft }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.statsRow}>
          {[
            { value: formatLocaleNum(monthStats.monthCount), label: '本月记录' },
            { value: formatLocaleNum(monthStats.avgKcal), label: '日均 kcal' },
            { value: `${monthStats.photoPct}%`, label: '拍照来源' },
          ].map((stat) => (
            <View
              key={stat.label}
              style={[styles.statCard, { backgroundColor: hh.card, borderColor: hh.line, shadowColor: hh.shadow }]}>
              <Text style={[styles.statValue, { color: hh.ink }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: hh.muted }]}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {focusYmd && filter === 'all' && !query ? (
          <Text style={[styles.focusHint, { color: hh.muted }]}>从首页进入 · 可浏览全部历史</Text>
        ) : null}

        {dayGroups.length === 0 ? (
          <View style={[styles.emptyBox, { backgroundColor: hh.card, borderColor: hh.line }]}>
            <MaterialIcons name="restaurant" size={28} color={hh.faint} />
            <Text style={[styles.emptyText, { color: hh.muted }]}>
              {lines.length === 0 ? '暂无摄入记录' : '没有符合筛选的记录'}
            </Text>
          </View>
        ) : (
          (() => {
            let staggerIndex = 0;
            return dayGroups.map((group, groupIndex) => (
              <View key={`${group.ymd}-${listAnimKey}`} style={styles.dayBlock}>
                <HealthRiseIn
                  animate={entranceOn}
                  index={groupIndex}
                  staggerMs={55}
                  duration={300}
                  fromY={8}
                >
                  <View style={styles.dayHead}>
                    <Text style={[styles.dayLabel, { color: hh.ink }]}>{group.label}</Text>
                    <Text style={[styles.daySummary, { color: hh.muted }]}>{group.summary}</Text>
                  </View>
                </HealthRiseIn>
                {group.lines.map((line, index) => {
                  const isLast = index === group.lines.length - 1;
                  const rowStagger = Math.min(staggerIndex++, 24);
                  const rowInner = (
                    <View style={styles.timelineRow}>
                      <View style={styles.timeCol}>
                        <Text style={[styles.timeText, { color: hh.muted }]}>{line.time}</Text>
                        <View style={[styles.railDot, { backgroundColor: line.iconColor }]} />
                        {!isLast ? <View style={[styles.railLine, { backgroundColor: hh.lineStrong }]} /> : null}
                      </View>
                      <View
                        style={[
                          styles.itemCard,
                          {
                            backgroundColor: hh.card,
                            borderColor: hh.line,
                            shadowColor: hh.shadow,
                          },
                        ]}>
                        <View style={[styles.itemIcon, { backgroundColor: line.iconBg }]}>
                          <MaterialIcons name={line.icon} size={18} color={line.iconColor} />
                        </View>
                        <View style={styles.itemBody}>
                          <Text style={[styles.itemTitle, { color: hh.ink }]} numberOfLines={1}>
                            {line.title}
                          </Text>
                          <Text style={[styles.itemMeta, { color: hh.muted }]} numberOfLines={1}>
                            {line.meta}
                          </Text>
                        </View>
                        <Text style={[styles.itemAmount, { color: hh.ink }]} numberOfLines={2}>
                          {line.amount}
                        </Text>
                      </View>
                    </View>
                  );

                  return (
                    <Swipeable
                      key={`${line.key}-${listAnimKey}`}
                      overshootRight={false}
                      rightThreshold={44}
                      // 入场动画放在 Swipeable 内；不透明底挡住常驻后方的删除条
                      childrenContainerStyle={{ backgroundColor: hh.paper }}
                      renderRightActions={() => (
                        <Pressable
                          onPress={() => confirmDelete(line.recordId)}
                          style={[styles.swipeDelete, { backgroundColor: '#C45C4A' }]}
                          accessibilityRole="button"
                          accessibilityLabel="删除这条记录">
                          <MaterialIcons name="delete" size={20} color="#fff" />
                          <Text style={styles.swipeDeleteText}>删除</Text>
                        </Pressable>
                      )}>
                      <HealthRiseIn
                        animate={entranceOn}
                        index={rowStagger}
                        staggerMs={30}
                        delayMs={80}
                        duration={300}
                        fromY={10}
                      >
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/intake-record-detail',
                              params: {
                                recordId: line.recordId,
                                date: line.ymd,
                                metric: line.metric,
                              },
                            })
                          }
                          onLongPress={() => confirmDelete(line.recordId)}
                          delayLongPress={280}
                          style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                          {rowInner}
                        </Pressable>
                      </HealthRiseIn>
                    </Swipeable>
                  );
                })}
              </View>
            ));
          })()
        )}

        {hasMore ? (
          <Pressable
            onPress={() => setVisibleCount((c) => c + LOAD_MORE_STEP)}
            style={[styles.loadMore, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
            <Text style={[styles.loadMoreText, { color: hh.pine }]}>
              滚动加载更多 · 已显示 {visibleLines.length} / {filteredLines.length}
            </Text>
          </Pressable>
        ) : filteredLines.length > 0 ? (
          <Text style={[styles.endHint, { color: hh.faint }]}>
            已显示全部 {filteredLines.length} 条
          </Text>
        ) : null}

        <View style={styles.footerHint}>
          <MaterialIcons name="schedule" size={13} color={hh.faint} />
          <Text style={[styles.footerHintText, { color: hh.faint }]}>
            左滑或长按任意记录可删除；删除后重算当天总量与积分
          </Text>
        </View>
      </ScrollView>

      <HealthIntakeDeleteConfirmSheet
        visible={deleteConfirm != null}
        preview={
          deleteConfirm
            ? {
                title: deleteConfirm.title,
                detail: deleteConfirm.detail,
                icon: deleteConfirm.icon,
                iconColor: deleteConfirm.iconColor,
              }
            : null
        }
        confirming={deletingId != null}
        onClose={() => {
          if (deletingId) return;
          setDeleteConfirm(null);
        }}
        onConfirm={() => {
          void performDelete();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  headerSub: { marginTop: 2, fontSize: 11, fontWeight: '600', letterSpacing: 0.4 },
  scroll: { paddingHorizontal: 16, paddingTop: 14 },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'center' },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: 14, fontWeight: '500', paddingVertical: 0 },
  filterRound: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipScroll: { marginHorizontal: -16, marginBottom: 14 },
  chipRow: { paddingHorizontal: 16, gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: { fontSize: 13, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  statValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  statLabel: { marginTop: 4, fontSize: 11, fontWeight: '600' },
  focusHint: { fontSize: 11, fontWeight: '600', marginBottom: 10, marginLeft: 2 },
  emptyBox: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 36,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: { fontSize: 13, fontWeight: '600' },
  dayBlock: { marginBottom: 18 },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  dayLabel: { fontSize: 14, fontWeight: '800' },
  daySummary: { fontSize: 12, fontWeight: '600' },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 8 },
  timeCol: { width: 44, alignItems: 'center', paddingTop: 14 },
  timeText: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  railDot: { width: 8, height: 8, borderRadius: 4 },
  railLine: { width: 1.5, flex: 1, marginTop: 4, minHeight: 28 },
  itemCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 15, fontWeight: '800' },
  itemMeta: { marginTop: 3, fontSize: 11, fontWeight: '500' },
  itemAmount: { fontSize: 13, fontWeight: '800', maxWidth: '30%', textAlign: 'right' },
  swipeDelete: {
    width: 72,
    alignSelf: 'stretch',
    marginVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swipeDeleteText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  loadMore: {
    marginTop: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadMoreText: { fontSize: 13, fontWeight: '700' },
  endHint: { textAlign: 'center', fontSize: 12, fontWeight: '600', marginTop: 8 },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 4,
  },
  footerHintText: { flex: 1, fontSize: 11, fontWeight: '500', lineHeight: 16 },
});
