import { DailyReviewContentCard } from '@/components/review/review-ui-parts';
import {
  dailyEntryHasContent,
  formatReviewHeaderDate,
  isDailyReviewEditableYmd,
  isDailyReviewSkippedForYmd,
  isFutureYmd,
} from '@/components/review/review-utils';
import { AppIconButton, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  collectColumnIds,
  emptyFieldValues,
  parseDailyReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const WEEK_TITLES = ['一', '二', '三', '四', '五', '六', '日'] as const;
const GRID_GAP = 5;

const PAGE_API_KEY = 'review-calendar';

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function buildGridCells(monthDate: Date) {
  const first = monthStart(monthDate);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }).map((_, idx) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + idx);
    const ymd = formatYmd(d);
    return {
      key: ymd,
      date: d,
      ymd,
      inCurrentMonth: d.getMonth() === monthDate.getMonth(),
    };
  });
}

export default function ReviewCalendarScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd } = useDayBoundary();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const todayDate = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalTodayYmd.trim());
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [logicalTodayYmd]);

  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(todayDate));
  const [selectedYmd, setSelectedYmd] = useState(logicalTodayYmd);
  const [filledSet, setFilledSet] = useState<Set<string>>(() => new Set());
  const [fieldsByYmd, setFieldsByYmd] = useState<Record<string, ReviewFieldValues>>({});
  const [dailyTemplate, setDailyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const columnIds = useMemo(() => collectColumnIds(dailyTemplate), [dailyTemplate]);

  const gridPadding = Spacing['3xl'] * 2;
  const cellSize = Math.floor((windowWidth - gridPadding - GRID_GAP * 6) / 7);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const [tpl, dow, rows] = await Promise.all([
            listReviewTemplate('daily'),
            getWeeklyReviewConfiguredWeekday(),
            (async () => {
              const first = monthStart(visibleMonth);
              const mondayOffset = (first.getDay() + 6) % 7;
              const gridStart = new Date(first);
              gridStart.setDate(first.getDate() - mondayOffset);
              const gridEnd = new Date(gridStart);
              gridEnd.setDate(gridStart.getDate() + 41);
              return listDailyReviewsBetween(formatYmd(gridStart), formatYmd(gridEnd));
            })(),
          ]);
          const colIds = collectColumnIds(tpl);
          const nextFilled = new Set<string>();
          const nextFields: Record<string, ReviewFieldValues> = {};
          for (const row of rows) {
            const fields = parseDailyReviewBody(row.body ?? '', colIds);
            if (!dailyEntryHasContent(fields)) continue;
            nextFilled.add(row.record_date_ymd);
            nextFields[row.record_date_ymd] = fields;
          }
          setDailyTemplate(tpl);
          setConfiguredDow(dow);
          setFilledSet(nextFilled);
          setFieldsByYmd(nextFields);
        }, forceApi);
      } finally {
        setLoading(false);
      }
    },
    [visibleMonth, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const cells = useMemo(() => buildGridCells(visibleMonth), [visibleMonth]);

  const selectedFields = fieldsByYmd[selectedYmd] ?? emptyFieldValues(columnIds);
  const selectedHasReview = filledSet.has(selectedYmd);
  const selectedDateLabel = formatReviewHeaderDate(selectedYmd);
  const isSelectedToday = selectedYmd === logicalTodayYmd;
  const isSelectedFuture = isFutureYmd(selectedYmd, logicalTodayYmd);
  const isSelectedSkipped = isDailyReviewSkippedForYmd(selectedYmd, configuredDow);
  const selectedCanEditDaily =
    isDailyReviewEditableYmd(selectedYmd, logicalTodayYmd) && !isSelectedSkipped;

  const selectedEmptyHint = isSelectedFuture
    ? isSelectedSkipped
      ? '该日为周复盘日，到达当天后再填写每周复盘'
      : '未来日期暂不可填写日复盘'
    : isSelectedSkipped
      ? '该日为周复盘日，请填写每周复盘'
      : '这一天还没有写下复盘，点这里去填写';

  const goWriteReview = useCallback(() => {
    router.push({ pathname: '/daily-review/[ymd]', params: { ymd: selectedYmd } });
  }, [router, selectedYmd]);

  const goWeeklyReview = useCallback(() => {
    router.push('/weekly-review-form');
  }, [router]);

  const selectedOnPress = selectedCanEditDaily
    ? goWriteReview
    : isSelectedSkipped && !isSelectedFuture
      ? goWeeklyReview
      : undefined;

  const detailStatusLabel = isSelectedFuture
    ? '未来'
    : isSelectedSkipped
      ? '周复盘日'
      : selectedHasReview
        ? '已填写'
        : '未填写';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title="复盘日历"
        subtitle={selectedDateLabel}
        onBack={() => router.back()}
        right={
          <AppIconButton
            icon="today"
            onPress={() => {
              setVisibleMonth(monthStart(todayDate));
              setSelectedYmd(logicalTodayYmd);
            }}
            accessibilityLabel="回到今天"
          />
        }
      />

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.scroll, { paddingBottom: Spacing['6xl'] + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.monthHeader}>
          <View>
            <Text style={[Typography.kicker, { color: colors.textMuted }]}>{visibleMonth.getFullYear()}</Text>
            <Text style={[Typography.h1, { color: colors.text }]}>{visibleMonth.getMonth() + 1}月</Text>
          </View>
          <View style={styles.monthNav}>
            <Pressable
              onPress={() => setVisibleMonth(m => addMonths(m, -1))}
              style={({ pressed }) => [
                styles.navBtn,
                { backgroundColor: colors.surface, borderColor: colors.outline },
                pressed && { opacity: 0.75 },
              ]}>
              <MaterialIcons name="chevron-left" size={22} color={colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => setVisibleMonth(m => addMonths(m, 1))}
              style={({ pressed }) => [
                styles.navBtn,
                { backgroundColor: colors.surface, borderColor: colors.outline },
                pressed && { opacity: 0.75 },
              ]}>
              <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.weekRow, { paddingHorizontal: Spacing['3xl'] }]}>
          {WEEK_TITLES.map(w => (
            <Text key={w} style={[styles.weekTitle, { color: colors.textMuted, width: cellSize }]}>
              {w}
            </Text>
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View style={[styles.grid, { paddingHorizontal: Spacing['3xl'], gap: GRID_GAP }]}>
            {cells.map(cell => {
              const isToday = cell.ymd === logicalTodayYmd;
              const isSelected = cell.ymd === selectedYmd;
              const isFuture = isFutureYmd(cell.ymd, logicalTodayYmd);
              const filled = filledSet.has(cell.ymd);
              return (
                <Pressable
                  key={cell.key}
                  onPress={() => setSelectedYmd(cell.ymd)}
                  style={({ pressed }) => [
                    styles.dayCell,
                    {
                      width: cellSize,
                      height: cellSize,
                      borderColor: isSelected ? colors.primary : isToday ? colors.success : colors.outline,
                      backgroundColor: isSelected
                        ? isDark
                          ? `${colors.primary}22`
                          : `${colors.primary}12`
                        : isFuture
                          ? isDark
                            ? 'rgba(15,23,42,0.35)'
                            : 'rgba(241,245,249,0.95)'
                          : filled
                            ? isDark
                              ? 'rgba(52,211,153,0.12)'
                              : 'rgba(236,253,245,0.95)'
                            : colors.surface,
                      opacity: cell.inCurrentMonth ? (pressed ? 0.88 : isFuture ? 0.72 : 1) : 0.42,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.dayNum,
                      {
                        color: isFuture
                          ? colors.textMuted
                          : cell.inCurrentMonth
                            ? colors.text
                            : colors.textMuted,
                        fontWeight: isToday || isSelected ? '900' : '700',
                      },
                    ]}>
                    {cell.date.getDate()}
                  </Text>
                  {filled ? (
                    <View style={[styles.filledDot, { backgroundColor: colors.success }]} />
                  ) : isFuture ? (
                    <MaterialIcons name="lock-outline" size={10} color={colors.textMuted} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.detailSection}>
          <View style={styles.detailHead}>
            <Text style={[Typography.label, { color: colors.textMuted }]}>选中日复盘</Text>
            {detailStatusLabel === '已填写' ? (
              <View style={[styles.statusBadge, { backgroundColor: isDark ? `${colors.success}28` : `${colors.success}16` }]}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: colors.success }}>已填写</Text>
              </View>
            ) : detailStatusLabel === '周复盘日' ? (
              <View style={[styles.statusBadge, { backgroundColor: isDark ? `${colors.primary}28` : `${colors.primary}14` }]}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: colors.primary }}>周复盘日</Text>
              </View>
            ) : detailStatusLabel === '未来' ? (
              <View style={[styles.statusBadge, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.14)' }]}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: colors.textMuted }}>未来</Text>
              </View>
            ) : (
              <Text style={[Typography.caption, { color: colors.textMuted }]}>未填写</Text>
            )}
          </View>

          <DailyReviewContentCard
            dateLabel={selectedDateLabel}
            tagLabel={isSelectedToday ? '今天' : isSelectedFuture ? '未来' : undefined}
            fields={selectedFields}
            template={dailyTemplate}
            hasContent={selectedHasReview}
            emptyHint={selectedEmptyHint}
            accentColor={isSelectedFuture ? colors.textMuted : isSelectedToday ? colors.success : colors.primary}
            isDark={isDark}
            surface={colors.surface}
            textColor={colors.text}
            mutedColor={colors.textMuted}
            borderColor={
              isSelectedFuture
                ? colors.outline
                : isSelectedToday
                  ? isDark
                    ? 'rgba(52,211,153,0.35)'
                    : 'rgba(0,108,73,0.22)'
                  : colors.outline
            }
            readOnly={selectedOnPress == null}
            onPress={selectedOnPress}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    paddingTop: Spacing.xl,
    gap: Spacing['3xl'],
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  monthHeader: {
    paddingHorizontal: Spacing['3xl'],
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  monthNav: { flexDirection: 'row', gap: Spacing.md },
  navBtn: {
    width: Layout.iconButtonSize,
    height: Layout.iconButtonSize,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekTitle: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  dayNum: { fontSize: 15 },
  filledDot: { width: 6, height: 6, borderRadius: 3 },
  loadingWrap: { paddingVertical: 40, alignItems: 'center' },
  detailSection: {
    paddingHorizontal: Spacing['3xl'],
    gap: Spacing.lg,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.lg,
  },
  statusBadge: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
});
