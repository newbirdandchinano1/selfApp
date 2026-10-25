import { FoldPopIn, FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { FoldCard, FoldIconButton, FoldPillButton, FoldTag, foldDimensionGlyph, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { FoldReviewFooter, FoldReviewHeader } from '@/components/review/fold-review-chrome';
import {
  dailyEntryHasContent,
  formatReviewHeaderDate,
  isDailyReviewEditableYmd,
  isDailyReviewSkippedForYmd,
  isFutureYmd,
  isoWeekNumber,
} from '@/components/review/review-utils';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  collectColumnIds,
  emptyFieldValues,
  parseDailyReviewBody,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { BUILTIN_REVIEW_DIMENSION_IDS } from '@/lib/repositories/insights/review-template-defaults';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  fetchReviewCatalog,
  fetchReviewJournal,
  shouldFetchReviewFromApi,
} from '@/lib/review-page-api';
import { formatYmd } from '@/lib/date';
import { refreshYmdFocusAfterLogicalDayChange } from '@/lib/tasks-logical-day';
import { getWeeklyReviewConfiguredWeekday } from '@/lib/weekly-review-settings';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

function previewText(dim: ReviewDimensionTemplate, fields: ReviewFieldValues): string {
  for (const col of dim.columns) {
    const plain = reviewContentToPlainDisplay(fields[col.id] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) return plain;
  }
  return '';
}

function isDimensionFilled(dim: ReviewDimensionTemplate, fields: ReviewFieldValues): boolean {
  return dim.columns.some(col => (fields[col.id] ?? '').trim().length > 0);
}

export default function ReviewCalendarScreen() {
  const router = useRouter();
  const { fold, palette } = useFoldTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const { logicalTodayYmd } = usePageDayBoundary('review');
  const { animate: motionOn } = useFoldMotionGate();

  const todayDate = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(logicalTodayYmd.trim());
    if (!m) return new Date();
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }, [logicalTodayYmd]);

  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(todayDate));
  const [selectedYmd, setSelectedYmd] = useState(logicalTodayYmd);
  const prevLogicalTodayYmdRef = useRef(logicalTodayYmd);
  useEffect(() => {
    const prev = prevLogicalTodayYmdRef.current;
    if (prev === logicalTodayYmd) return;
    prevLogicalTodayYmdRef.current = logicalTodayYmd;
    setSelectedYmd((focusPrev) =>
      refreshYmdFocusAfterLogicalDayChange(focusPrev, logicalTodayYmd, prev),
    );
    setVisibleMonth(monthStart(todayDate));
  }, [logicalTodayYmd, todayDate]);
  const [filledSet, setFilledSet] = useState<Set<string>>(() => new Set());
  const [fieldsByYmd, setFieldsByYmd] = useState<Record<string, ReviewFieldValues>>({});
  const [dailyTemplate, setDailyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const columnIds = useMemo(() => collectColumnIds(dailyTemplate), [dailyTemplate]);

  const gridPadding = 32;
  const cellSize = Math.floor((windowWidth - gridPadding - GRID_GAP * 6) / 7);

  const reload = useCallback(
    async (forceRefresh = false) => {
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const first = monthStart(visibleMonth);
          const mondayOffset = (first.getDay() + 6) % 7;
          const gridStart = new Date(first);
          gridStart.setDate(first.getDate() - mondayOffset);
          const gridEnd = new Date(gridStart);
          gridEnd.setDate(gridStart.getDate() + 41);
          const start = formatYmd(gridStart);
          const end = formatYmd(gridEnd);

          if (shouldFetchReviewFromApi()) {
            await Promise.all([
              fetchReviewCatalog({ scope: 'daily' }),
              fetchReviewJournal({ scope: 'daily', start, end }),
            ]);
          }

          const [tpl, dow, rows] = await Promise.all([
            listReviewTemplate('daily'),
            getWeeklyReviewConfiguredWeekday(),
            listDailyReviewsBetween(start, end),
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
        }, forceRefresh);
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
  const selectedDateLabel = formatReviewHeaderDate(selectedYmd).replace(' ', ' · ');
  const isSelectedToday = selectedYmd === logicalTodayYmd;
  const isSelectedFuture = isFutureYmd(selectedYmd, logicalTodayYmd);
  const isSelectedSkipped = isDailyReviewSkippedForYmd(selectedYmd, configuredDow);
  const selectedCanEditDaily =
    isDailyReviewEditableYmd(selectedYmd, logicalTodayYmd) && !isSelectedSkipped;
  const selectedCanEditWeekly = isSelectedSkipped && !isSelectedFuture;

  const filledDimCount = useMemo(
    () => dailyTemplate.filter(dim => isDimensionFilled(dim, selectedFields)).length,
    [dailyTemplate, selectedFields],
  );

  const selectedEmptyHint = isSelectedFuture
    ? isSelectedSkipped
      ? '该日为周复盘日，到达当天后再填写每周复盘'
      : '未来日期暂不可填写日复盘'
    : isSelectedSkipped
      ? '该日为周复盘日，请填写每周复盘'
      : '这一天还没有写下复盘，点下方按钮去填写';

  const selectedEmoji = isSelectedFuture
    ? '🌙'
    : isSelectedSkipped
      ? '🌿'
      : selectedHasReview
        ? '🥳'
        : '🌱';

  const goWriteReview = useCallback(() => {
    router.push({ pathname: '/daily-review/[ymd]', params: { ymd: selectedYmd } });
  }, [router, selectedYmd]);

  const goWeeklyReview = useCallback(() => {
    router.push('/weekly-review-form');
  }, [router]);

  const goToday = useCallback(() => {
    setVisibleMonth(monthStart(todayDate));
    setSelectedYmd(logicalTodayYmd);
  }, [logicalTodayYmd, todayDate]);

  const weekNumber = useMemo(
    () => isoWeekNumber(formatYmd(visibleMonth)),
    [visibleMonth],
  );

  const monthTitle = `${visibleMonth.getFullYear()} 年 ${visibleMonth.getMonth() + 1} 月`;
  const prevMonthLabel = addMonths(visibleMonth, -1).getMonth() + 1;
  const nextMonthLabel = addMonths(visibleMonth, 1).getMonth() + 1;

  const openHub = useCallback(() => router.navigate('/review'), [router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <FoldReviewHeader
        title="复盘日历"
        subtitle="CALENDAR · 42 CELLS"
        onBack={() => router.back()}
        right={
          <>
            <FoldPillButton label="今天" variant="soft" onPress={goToday} accessibilityLabel="回到今天" />
            <FoldIconButton
              icon="settings"
              variant="soft"
              onPress={() => router.push('/review-settings')}
              accessibilityLabel="打开复盘设置"
            />
          </>
        }
      />

      <ScrollView
        refreshControl={refreshControl}
        contentContainerStyle={[styles.scroll, { paddingBottom: 16 + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <FoldRiseIn animate={motionOn} index={0} duration={420} fromY={12}>
          <View style={styles.monthHeader}>
            <View style={styles.monthTitleRow}>
              <Text style={[styles.monthTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.25}>
                {monthTitle}
              </Text>
              <Text style={[styles.weekNumber, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                W{weekNumber}
              </Text>
            </View>
            <View style={styles.monthNav}>
              <Pressable
                onPress={() => setVisibleMonth(m => addMonths(m, -1))}
                accessibilityRole="button"
                accessibilityLabel="上一月"
                style={({ pressed }) => [
                  styles.monthNavBtn,
                  { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.75 : 1 },
                ]}>
                <MaterialIcons name="chevron-left" size={15} color={fold.muted} />
                <Text style={[styles.monthNavText, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                  {prevMonthLabel}月
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibleMonth(m => addMonths(m, 1))}
                accessibilityRole="button"
                accessibilityLabel="下一月"
                style={({ pressed }) => [
                  styles.monthNavBtn,
                  { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.75 : 1 },
                ]}>
                <Text style={[styles.monthNavText, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                  {nextMonthLabel}月
                </Text>
                <MaterialIcons name="chevron-right" size={15} color={fold.muted} />
              </Pressable>
            </View>
          </View>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={1} staggerMs={55} duration={400}>
          <View style={styles.weekRow}>
            {WEEK_TITLES.map((w, index) => (
              <Text
                key={w}
                style={[
                  styles.weekTitle,
                  {
                    width: cellSize,
                    color: index >= 5 ? palette.clay : fold.muted,
                  },
                ]}
                maxFontSizeMultiplier={1.2}>
                {w}
              </Text>
            ))}
          </View>
        </FoldRiseIn>

        {loading ? (
          <View style={[styles.gridLoading, { minHeight: cellSize * 6 + GRID_GAP * 5 }]}>
            <ActivityIndicator color={fold.pine} />
          </View>
        ) : (
          <View style={[styles.grid, { gap: GRID_GAP }]}>
            {cells.map((cell, index) => {
              const isToday = cell.ymd === logicalTodayYmd;
              const isSelected = cell.ymd === selectedYmd;
              const isFuture = isFutureYmd(cell.ymd, logicalTodayYmd);
              const filled = filledSet.has(cell.ymd);
              const skipped = isDailyReviewSkippedForYmd(cell.ymd, configuredDow);
              const dotColor = skipped
                ? fold.amber
                : filled
                  ? palette.sage
                  : fold.line2;
              return (
                <FoldPopIn
                  key={cell.key}
                  animate={motionOn}
                  index={index}
                  staggerMs={12}
                  delayMs={80}
                  duration={320}>
                  <Pressable
                    onPress={() => {
                      setSelectedYmd(cell.ymd);
                      if (!cell.inCurrentMonth) setVisibleMonth(monthStart(cell.date));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatReviewHeaderDate(cell.ymd)}，${
                      skipped ? '周复盘日' : filled ? '已填' : isFuture ? '未来' : '未填写'
                    }`}
                    style={({ pressed }) => [
                      styles.dayCell,
                      {
                        width: cellSize,
                        height: cellSize,
                        backgroundColor: isSelected
                          ? palette.pineSolid
                          : isToday
                            ? fold.amber2
                            : 'transparent',
                        borderColor: isSelected
                          ? palette.pineSolid
                          : isToday
                            ? fold.amber
                            : 'transparent',
                        opacity: cell.inCurrentMonth ? (pressed ? 0.8 : 1) : 0.34,
                      },
                    ]}>
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isSelected
                            ? fold.onPineButton
                            : isFuture
                              ? fold.faint
                              : cell.inCurrentMonth
                                ? fold.ink2
                                : fold.faint,
                          fontWeight: isToday || isSelected ? '800' : '600',
                        },
                      ]}
                      maxFontSizeMultiplier={1.15}>
                      {cell.date.getDate()}
                    </Text>
                    {isSelected && isToday ? (
                      <Text style={[styles.todayMini, { color: fold.onPineButton }]} maxFontSizeMultiplier={1}>
                        今天
                      </Text>
                    ) : (
                      <View
                        style={[
                          styles.dayDot,
                          {
                            backgroundColor: dotColor,
                            opacity: isFuture ? 0.5 : filled || skipped ? 1 : 0.7,
                          },
                        ]}
                      />
                    )}
                  </Pressable>
                </FoldPopIn>
              );
            })}
          </View>
        )}

        <FoldRiseIn animate={motionOn} index={2} delayMs={220} staggerMs={0} duration={420}>
        <FoldCard style={styles.detailCard}>
          <View style={styles.detailHead}>
            <View style={styles.detailHeadText}>
              <Text style={[styles.detailDate, { color: fold.ink }]} maxFontSizeMultiplier={1.25}>
                {selectedDateLabel}
              </Text>
              <Text style={[styles.detailSub, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
                {selectedHasReview ? `${filledDimCount} 个维度已有落笔` : '留一页给这一天'}
              </Text>
            </View>
            <Text style={styles.detailEmoji}>{selectedEmoji}</Text>
          </View>

          <View style={styles.tagRow}>
            {isSelectedToday ? <FoldTag tone="clay">今天</FoldTag> : null}
            {isSelectedSkipped ? <FoldTag tone="pine">每周复盘日</FoldTag> : null}
            {selectedHasReview ? (
              <FoldTag tone="green">{filledDimCount} 维已填</FoldTag>
            ) : (
              <FoldTag tone="gray">{isSelectedFuture ? '未来只读' : '未填写'}</FoldTag>
            )}
          </View>

          {selectedHasReview ? (
            dailyTemplate.length === 0 ? (
              <View style={[styles.emptyBox, { borderColor: fold.line2 }]}>
                <Text style={[styles.emptyHint, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                  还没有配置日复盘维度，先到「复盘模板 · 日 / 周 / 月」里挑几个维度。
                </Text>
              </View>
            ) : (
              <View style={styles.dimGrid}>
                {dailyTemplate.map(dim => {
                  const filled = isDimensionFilled(dim, selectedFields);
                  const preview = previewText(dim, selectedFields);
                  const meta = dimensionMeta(dim.id, fold, palette);
                  return (
                    <View
                      key={dim.id}
                      style={[
                        styles.dimTile,
                        { backgroundColor: fold.card, borderColor: fold.line },
                      ]}>
                      <View style={styles.dimHead}>
                        <View style={[styles.dimIcon, { backgroundColor: meta.bg }]}>
                          <Text style={[styles.dimGlyph, { color: meta.color }]}>
                            {foldDimensionGlyph(dim.id)}
                          </Text>
                        </View>
                        <Text
                          style={[styles.dimTitle, { color: fold.ink2 }]}
                          numberOfLines={1}
                          maxFontSizeMultiplier={1.2}>
                          {dim.title}
                        </Text>
                      </View>
                      <Text
                        style={[styles.dimPreview, { color: filled ? fold.muted : fold.faint }]}
                        numberOfLines={2}
                        maxFontSizeMultiplier={1.25}>
                        {preview || '还没有填写'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )
          ) : (
            <View style={[styles.emptyBox, { borderColor: fold.line2 }]}>
              <View style={styles.emptyHead}>
                <Text style={[styles.emptyKicker, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                  空态提示 · EMPTY
                </Text>
                <Text style={[styles.emptyHint, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                  {selectedEmptyHint}
                </Text>
              </View>
              <EmptyLine color={palette.sage} text="未来：这一天还没到，先过好今天。" />
              <EmptyLine color={fold.amber} text="周复盘日：这一天每周只写周复盘，写下这一周吧。" />
              <EmptyLine color={fold.line2} text="未填写：这一天还没有留下文字，补上三分钟。" />
            </View>
          )}

          <View style={styles.actionRow}>
            <Pressable
              onPress={goWriteReview}
              disabled={!selectedCanEditDaily}
              accessibilityRole="button"
              accessibilityLabel="打开日复盘"
              accessibilityState={{ disabled: !selectedCanEditDaily }}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: selectedCanEditDaily ? palette.pineSolid : fold.paper2,
                  borderColor: selectedCanEditDaily ? palette.pineSolid : fold.line,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <MaterialIcons
                name="edit-note"
                size={15}
                color={selectedCanEditDaily ? palette.onPine : fold.faint}
              />
              <Text
                style={[
                  styles.actionText,
                  { color: selectedCanEditDaily ? palette.onPine : fold.faint },
                ]}
                maxFontSizeMultiplier={1.25}>
                打开日复盘
              </Text>
            </Pressable>
            <Pressable
              onPress={goWeeklyReview}
              disabled={!selectedCanEditWeekly}
              accessibilityRole="button"
              accessibilityLabel="打开周复盘"
              accessibilityState={{ disabled: !selectedCanEditWeekly }}
              style={({ pressed }) => [
                styles.actionBtn,
                {
                  backgroundColor: fold.card,
                  borderColor: selectedCanEditWeekly ? fold.sage : fold.line,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <MaterialIcons
                name="date-range"
                size={15}
                color={selectedCanEditWeekly ? fold.pine : fold.faint}
              />
              <Text
                style={[styles.actionText, { color: selectedCanEditWeekly ? fold.pine : fold.faint }]}
                maxFontSizeMultiplier={1.25}>
                打开周复盘
              </Text>
            </Pressable>
          </View>
        </FoldCard>
        </FoldRiseIn>

        <FoldRiseIn animate={motionOn} index={3} delayMs={280} staggerMs={0} duration={360}>
          <View style={styles.legendRow}>
            <Legend color={palette.sage} label="已填写" />
            <Legend color={fold.amber} label="周复盘日" />
            <Legend color={fold.line2} label="未填写" />
            <Legend color={fold.amber2} label="今天" border={fold.amber} />
          </View>
        </FoldRiseIn>
      </ScrollView>

      <FoldReviewFooter
        sibling="settings"
        onOpenHub={openHub}
        onOpenSibling={() => router.push('/review-settings')}
      />
    </SafeAreaView>
  );
}

function EmptyLine({ color, text }: { color: string; text: string }) {
  const { fold } = useFoldTheme();
  return (
    <View style={styles.emptyLine}>
      <View style={[styles.emptyDot, { backgroundColor: color }]} />
      <Text style={[styles.emptyLineText, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
        {text}
      </Text>
    </View>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: string }) {
  const { fold } = useFoldTheme();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color, borderColor: border ?? 'transparent' }]} />
      <Text style={[styles.legendText, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

type DimMeta = {
  color: string;
  bg: string;
};

function dimensionMeta(
  id: string,
  fold: ReturnType<typeof useFoldTheme>['fold'],
  palette: ReturnType<typeof useFoldTheme>['palette'],
): DimMeta {
  const daily = BUILTIN_REVIEW_DIMENSION_IDS.daily;
  switch (id) {
    case daily.health:
      return { color: palette.sageInk, bg: fold.sage2 };
    case daily.tasks:
      return { color: fold.ink2, bg: fold.paper2 };
    case daily.finance:
      return { color: palette.amberInk, bg: fold.amber2 };
    case daily.routine:
      return { color: fold.ink2, bg: fold.paper2 };
    case daily.defects:
      return { color: palette.clayInk, bg: fold.clay2 };
    case daily.ideas:
      return { color: fold.pine, bg: fold.sage2 };
    default:
      return { color: fold.muted, bg: fold.paper2 };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 2,
    gap: 12,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  monthTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 7,
    flexShrink: 1,
  },
  monthTitle: {
    fontFamily: foldFonts.serif,
    fontSize: 23,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  weekNumber: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  monthNav: { flexDirection: 'row', gap: 6 },
  monthNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 5,
    paddingHorizontal: 7,
  },
  monthNavText: { fontSize: 10, fontWeight: '700' },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  weekTitle: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '800',
  },
  gridLoading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dayNum: {
    fontSize: 14,
    fontFamily: foldFonts.mono,
    letterSpacing: -0.4,
  },
  dayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  todayMini: {
    fontSize: 7.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  detailCard: { gap: 12 },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  detailHeadText: { flex: 1, minWidth: 0, gap: 3 },
  detailDate: {
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  detailSub: { fontSize: 10.5 },
  detailEmoji: { fontSize: 24 },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dimGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dimTile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 62,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 9,
    gap: 5,
  },
  dimHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dimIcon: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimGlyph: { fontSize: 11, fontWeight: '800' },
  dimTitle: { fontSize: 11.5, fontWeight: '800', flexShrink: 1 },
  dimPreview: { fontSize: 10.5, lineHeight: 15 },
  emptyBox: {
    borderRadius: 13,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: 11,
    gap: 6,
  },
  emptyHead: { gap: 3, marginBottom: 2 },
  emptyKicker: { fontSize: 8.5, fontWeight: '800', letterSpacing: 1.2 },
  emptyHint: { fontSize: 11.5, fontWeight: '700', lineHeight: 17 },
  emptyLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  emptyDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  emptyLineText: { flex: 1, fontSize: 10.5, lineHeight: 15 },
  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionText: { fontSize: 12.5, fontWeight: '800' },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendText: { fontSize: 9.5, fontWeight: '600' },
});
