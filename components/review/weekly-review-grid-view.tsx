import { ReviewGridSkeleton } from '@/components/skeletons/review';
import { ReviewAiAnalysisScreen } from '@/components/review/review-ai-analysis-screen';
import { WeeklyReviewLockedView } from '@/components/review/weekly-review-locked-view';
import {
  FoldCard,
  FoldDimensionGrid,
  FoldPillButton,
  FoldSectionHeader,
  FoldTag,
  foldFonts,
  useFoldTheme,
} from '@/components/review/fold-ui';
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import {
  dailyEntryHasContent,
  isDailySkipped,
  isoWeekNumber,
  loadReviewPeriodSnapshot,
  rollupWeeklyFieldsFromDailyEntries,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
  type DailyEntry,
} from '@/components/review/review-utils';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import {
  collectColumnIds,
  emptyFieldValues,
  parseWeeklyReviewFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import {
  ensureBuiltinCascadeReviewModules,
  listReviewTemplate,
} from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  fetchWeeklyReviewMetrics,
  getRollingSevenDayRange,
  getRollingSevenDayRangeEndingOnNextReviewDay,
  type WeeklyReviewMetrics,
} from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewJournalByWeek,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import { reportTabBarScroll } from '@/lib/tab-bar-auto-hide';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RefreshControlProps, TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AUTO_SAVE_MS = 900;

const monoText: TextStyle = {
  fontFamily: foldFonts.mono,
  fontVariant: ['tabular-nums'],
};

function clockLabel(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function ymdDayNumber(ymd: string): string {
  const day = Number(ymd.slice(8, 10));
  return Number.isFinite(day) ? String(day) : ymd.slice(8, 10);
}

function ymdWeekdayLabel(label: string): string {
  return label.split(' ')[1] ?? '';
}

export function WeeklyReviewGridView({
  pageApiKey,
  refreshControl,
  onRegisterReload,
  onSwitchToMonthly,
}: {
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onRegisterReload?: (reload: () => Promise<void>) => void;
  onSwitchToMonthly?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [weeklyTemplate, setWeeklyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([]);
  const [metrics, setMetrics] = useState<WeeklyReviewMetrics | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [periodStartYmd, setPeriodStartYmd] = useState('');
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [summarizedAt, setSummarizedAt] = useState<Date | null>(null);
  const [aiCoaching, setAiCoaching] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const journalMetaRef = useRef({
    execution_score: 0,
    adjust_tasks: false,
    adjust_savings: false,
    adjust_plans: false,
  });

  const hydratedRef = useRef(false);
  const skipFirstFocusReloadRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skippedYmds = useMemo(() => {
    const set = new Set<string>();
    for (const e of dailyEntries) {
      if (isDailySkipped(e.ymd, reviewCycleEndYmd, configuredDow)) set.add(e.ymd);
    }
    return set;
  }, [configuredDow, dailyEntries, reviewCycleEndYmd]);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true;
      hydratedRef.current = false;
      if (!silent) setLoading(true);
      try {
        await wrapLoad(async () => {
          await ensureBuiltinCascadeReviewModules();
          const [snapshot, weeklyTpl] = await Promise.all([
            loadReviewPeriodSnapshot(todayYmd),
            listReviewTemplate('weekly'),
          ]);
          setConfiguredDow(snapshot.configuredDow);
          setCanEdit(snapshot.canEditWeekly);
          setWeekRangeLabel(snapshot.weekRangeLabel);
          setDailyEntries(snapshot.dailyEntries);
          setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);

          const rolling =
            snapshot.configuredDow !== null
              ? getRollingSevenDayRangeEndingOnNextReviewDay(new Date(), snapshot.configuredDow)
              : getRollingSevenDayRange(new Date());
          const startYmd = rolling.startYmd;
          setPeriodStartYmd(startYmd);
          setWeeklyTemplate(weeklyTpl);

          const wColIds = collectColumnIds(weeklyTpl);
          const [row, weekMetrics] = await Promise.all([
            getWeeklyReviewJournalByWeek(startYmd),
            fetchWeeklyReviewMetrics(rolling.end, 'rolling-7').catch(() => null),
          ]);
          const base = row ? parseWeeklyReviewFields(row, wColIds) : emptyFieldValues(wColIds);
          setFields(
            rollupWeeklyFieldsFromDailyEntries(
              base,
              snapshot.dailyEntries,
              snapshot.reviewCycleEndYmd,
              snapshot.configuredDow,
            ),
          );
          setAiCoaching(row?.ai_coaching ?? null);
          setMetrics(weekMetrics);
          setSummarizedAt(new Date());
          journalMetaRef.current = {
            execution_score: row?.execution_score ?? 0,
            adjust_tasks: row?.adjust_tasks === 1,
            adjust_savings: row?.adjust_savings === 1,
            adjust_plans: row?.adjust_plans === 1,
          };
        });
      } catch {
        setFields({});
        setWeeklyTemplate([]);
        setAiCoaching(null);
        setMetrics(null);
      } finally {
        setLoading(false);
        hydratedRef.current = true;
      }
    },
    [todayYmd, wrapLoad],
  );

  useEffect(() => {
    void reload({ silent: false });
  }, [reload]);

  useEffect(() => {
    if (!onRegisterReload) return;
    onRegisterReload(() => reload({ silent: true }));
    return () => onRegisterReload(async () => {});
  }, [onRegisterReload, reload]);

  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocusReloadRef.current) {
        skipFirstFocusReloadRef.current = false;
        return;
      }
      void reload({ silent: true });
    }, [reload]),
  );

  const persist = useCallback(async () => {
    if (!canEdit || !periodStartYmd) return;
    setSaving(true);
    try {
      const meta = journalMetaRef.current;
      await upsertWeeklyReviewJournal({
        week_start_ymd: periodStartYmd,
        fields,
        execution_score: meta.execution_score,
        adjust_tasks: meta.adjust_tasks,
        adjust_savings: meta.adjust_savings,
        adjust_plans: meta.adjust_plans,
      });
      setSummarizedAt(new Date());
    } catch (e) {
      console.warn('weekly review save', e);
      toast.error(toUserMessage(e, '复盘保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [canEdit, fields, periodStartYmd]);

  useEffect(() => {
    if (!hydratedRef.current || !canEdit) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist();
    }, AUTO_SAVE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [canEdit, fields, persist]);

  const openDimension = useCallback(
    (dimensionId: string) => {
      if (!periodStartYmd) return;
      router.push({
        pathname: '/weekly-review/[weekStartYmd]/[dimensionId]',
        params: { weekStartYmd: periodStartYmd, dimensionId },
      });
    },
    [periodStartYmd, router],
  );

  const persistAiText = useCallback(
    async (text: string) => {
      if (!periodStartYmd) return;
      const meta = journalMetaRef.current;
      await upsertWeeklyReviewJournal({
        week_start_ymd: periodStartYmd,
        fields,
        execution_score: meta.execution_score,
        adjust_tasks: meta.adjust_tasks,
        adjust_savings: meta.adjust_savings,
        adjust_plans: meta.adjust_plans,
        ai_coaching: text,
      });
      setAiCoaching(text);
    },
    [fields, periodStartYmd],
  );

  const onOpenAi = useCallback(() => {
    setAiOpen(true);
  }, []);

  const configuredDowLabel = useMemo(
    () => (configuredDow !== null ? WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow] : undefined),
    [configuredDow],
  );

  const weekAnchorYmd = periodStartYmd || dailyEntries[0]?.ymd || todayYmd;
  const weekNo = useMemo(() => isoWeekNumber(weekAnchorYmd), [weekAnchorYmd]);
  const weekYear = Number(weekAnchorYmd.slice(0, 4)) || new Date().getFullYear();

  const dimensionCards = useMemo(
    () =>
      weeklyTemplate.map(dim => {
        const filled = dim.columns.some(
          col => reviewContentToPlainDisplay(fields[col.id] ?? '').replace(/\s/g, '').length > 0,
        );
        return { id: dim.id, filled };
      }),
    [fields, weeklyTemplate],
  );
  const filledDimensionCount = dimensionCards.filter(card => card.filled).length;
  const firstOpenDimensionId = useMemo(
    () => dimensionCards.find(card => !card.filled)?.id ?? dimensionCards[0]?.id,
    [dimensionCards],
  );

  const stats = metrics
    ? [
        { value: String(metrics.tasksCompleted), unit: '项任务完成' },
        { value: String(metrics.habitCheckInTotal), unit: '次打卡' },
        { value: `¥${metrics.savingsWeekTotal}`, unit: '存下' },
      ]
    : [
        { value: '—', unit: '项任务完成' },
        { value: '—', unit: '次打卡' },
        { value: '—', unit: '存下' },
      ];

  if (loading) {
    return <ReviewGridSkeleton />;
  }

  return (
    <>
    <ScrollView
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: 72 + glassTabBarContentInset(insets.bottom) },
      ]}
      onScroll={e => reportTabBarScroll(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}>
      <View style={styles.page}>
        <View style={styles.weekHead}>
          <View style={styles.weekHeadText}>
            <Text maxFontSizeMultiplier={1.25} style={[styles.weekTitle, { color: fold.pine, fontFamily: foldFonts.serif }]}>
              第 {weekNo} 周
            </Text>
            <Text maxFontSizeMultiplier={1.3} style={[styles.weekSub, { color: fold.muted }]}>
              {weekRangeLabel || '本周期'}
              {configuredDowLabel ? ` · 以${configuredDowLabel}为终点` : ''}
            </Text>
          </View>
          <View style={styles.weekTag}>
            {configuredDow === null ? (
              <FoldTag tone="amber">未设置复盘日</FoldTag>
            ) : canEdit ? (
              <FoldTag tone="green">今天是复盘日</FoldTag>
            ) : (
              <FoldTag tone="gray">未到复盘日 · 只读</FoldTag>
            )}
          </View>
        </View>

        {!canEdit ? (
          <WeeklyReviewLockedView
            weekNo={weekNo}
            weekRangeLabel={weekRangeLabel || '本周期'}
            configuredDow={configuredDow}
            configuredDowLabel={configuredDowLabel}
            reviewCycleEndYmd={reviewCycleEndYmd}
            todayYmd={todayYmd}
            dailyEntries={dailyEntries}
            skippedYmds={skippedYmds}
            dimensions={weeklyTemplate}
            fields={fields}
            onOpenDimension={openDimension}
            onOpenDay={ymd => router.push({ pathname: '/daily-review/[ymd]', params: { ymd } })}
            onOpenSettings={() => router.push('/review-settings')}
          />
        ) : null}

        {canEdit ? (
          <>
        <FoldCard style={styles.storyCard}>
          <View style={styles.storyHead}>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.25}
              style={[styles.storyKicker, { color: fold.ink2 }]}>
              周故事 · STORY OF THE WEEK
            </Text>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
              style={[styles.storyMeta, monoText, { color: fold.muted }]}>
              {weekYear} / W{weekNo}
            </Text>
          </View>

          <View style={styles.statsRow}>
            {stats.map((stat, index) => (
              <React.Fragment key={stat.unit}>
                {index > 0 ? <View style={[styles.statDivider, { backgroundColor: fold.line }]} /> : null}
                <View style={styles.statCell}>
                  <Text
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.15}
                    style={[styles.statValue, monoText, { color: fold.pine }]}>
                    {stat.value}
                  </Text>
                  <Text numberOfLines={1} maxFontSizeMultiplier={1.25} style={[styles.statUnit, { color: fold.muted }]}>
                    {stat.unit}
                  </Text>
                </View>
              </React.Fragment>
            ))}
          </View>

          <View style={styles.timeline}>
            <View style={[styles.timelineLine, { backgroundColor: fold.line }]} />
            {dailyEntries.map(entry => {
              const skipped = skippedYmds.has(entry.ymd);
              const filled = !skipped && dailyEntryHasContent(entry.fields);
              const isToday = entry.ymd === todayYmd;
              return (
                <View key={entry.ymd} style={styles.timelineItem}>
                  <View
                    style={[
                      styles.timelineNode,
                      skipped
                        ? { backgroundColor: fold.pine, borderColor: fold.pine }
                        : filled
                          ? { backgroundColor: fold.sage2, borderColor: fold.sage }
                          : { backgroundColor: fold.paper2, borderColor: fold.line },
                      isToday && !skipped ? { borderColor: fold.amber, borderWidth: 1.5 } : null,
                    ]}>
                    {skipped ? (
                      <MaterialIcons name="star" size={11} color={fold.onPineButton} />
                    ) : filled ? (
                      <MaterialIcons name="check" size={13} color={fold.pine2} />
                    ) : null}
                  </View>
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={[styles.timelineDow, { color: isToday ? fold.clay : fold.muted }]}>
                    {ymdWeekdayLabel(entry.label)}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={1.2}
                    style={[
                      styles.timelineDay,
                      monoText,
                      { color: skipped ? fold.pine : fold.ink2, fontWeight: skipped ? '800' : '600' },
                    ]}>
                    {ymdDayNumber(entry.ymd)}
                  </Text>
                </View>
              );
            })}
          </View>
        </FoldCard>

        <View style={styles.summaryRow}>
          <MaterialIcons name="sync" size={11} color={fold.sage} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.summaryText, { color: fold.muted }]}>
            空栏已自动汇总近 7 天日复盘，已填内容不会被覆盖
          </Text>
        </View>

        <FoldSectionHeader
          title="维度预览"
          hint={`${weeklyTemplate.length} 维 · ${filledDimensionCount} 维已填`}
        />

        {weeklyTemplate.length === 0 ? (
          <FoldCard tone="muted">
            <Text style={[styles.emptyTitle, { color: fold.ink2 }]}>尚未配置周复盘维度</Text>
            <Text style={[styles.emptyText, { color: fold.muted }]}>
              点右上角「模板」按钮，编辑标题与栏目。
            </Text>
          </FoldCard>
        ) : (
          <FoldDimensionGrid
            scope="weekly"
            dimensions={weeklyTemplate}
            fields={fields}
            canEdit={canEdit}
            onOpenDimension={openDimension}
          />
        )}

        <Pressable
          onPress={onOpenAi}
          accessibilityRole="button"
          accessibilityLabel="AI 周教练 · 本周建议"
          style={({ pressed }) => [
            styles.aiCard,
            {
              backgroundColor: fold.card,
              borderColor: fold.line,
              opacity: pressed ? 0.92 : 1,
            },
          ]}>
          <View style={styles.aiRow}>
            <View style={[styles.aiBadge, { backgroundColor: fold.summaryBg }]}>
              <MaterialIcons name="auto-awesome" size={15} color={fold.onPineButton} />
            </View>
            <View style={styles.aiBody}>
              <View style={styles.aiHead}>
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.3}
                  style={[styles.aiTitle, { color: fold.ink }]}>
                  AI 周教练 · 本周建议
                </Text>
                <MaterialIcons name="north-east" size={13} color={fold.muted} />
              </View>
              {(aiCoaching ?? '').trim() ? (
                <Text numberOfLines={4} maxFontSizeMultiplier={1.3} style={[styles.aiBodyText, { color: fold.ink2 }]}>
                  {aiCoaching}
                </Text>
              ) : (
                <Text numberOfLines={3} maxFontSizeMultiplier={1.3} style={[styles.aiBodyText, { color: fold.muted }]}>
                  填写本周复盘后，会基于六个维度生成一份观察与建议。
                </Text>
              )}
              <Text style={[styles.aiAction, { color: fold.aiInk }]}>
                {(aiCoaching ?? '').trim() ? '查看全文 · 重新生成 ›' : '生成本周建议 ›'}
              </Text>
            </View>
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              if (firstOpenDimensionId) openDimension(firstOpenDimensionId);
            }}
            disabled={!firstOpenDimensionId}
            accessibilityRole="button"
            accessibilityLabel={canEdit ? '填写本周复盘' : '查看本周复盘'}
            style={({ pressed }) => [
              styles.primaryAction,
              {
                backgroundColor: fold.pineButton,
                opacity: !firstOpenDimensionId ? 0.4 : pressed ? 0.88 : 1,
              },
            ]}>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}
              style={[styles.primaryActionText, { color: fold.onPineButton }]}>
              {canEdit ? '填写本周复盘' : '查看本周复盘'}
            </Text>
            <MaterialIcons name="chevron-right" size={16} color={fold.onPineButton} />
          </Pressable>
          <FoldPillButton
            label="经典表单"
            onPress={() => router.push('/weekly-review-form')}
            style={styles.classicBtn}
          />
        </View>

        <View style={styles.autoSave}>
          <View
            style={[
              styles.autoSaveDot,
              { backgroundColor: saving ? fold.amber : summarizedAt ? fold.sage : fold.faint },
            ]}
          />
          <Text maxFontSizeMultiplier={1.25} style={[styles.autoSaveText, { color: fold.faint }]}>
            {saving
              ? '保存中…'
              : summarizedAt
                ? `已自动汇总 · ${clockLabel(summarizedAt)}`
                : '自动汇总已开启'}
          </Text>
        </View>

        <View style={styles.pageLinks}>
          <Pressable
            onPress={onSwitchToMonthly}
            disabled={!onSwitchToMonthly}
            accessibilityRole="button"
            accessibilityLabel="月复盘"
            style={({ pressed }) => [
              styles.pageLink,
              { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.75 : 1 },
            ]}>
            <Text style={[styles.pageIndex, { color: fold.ink2 }]}>月</Text>
            <Text style={[styles.pageLinkText, { color: fold.ink2 }]}>月复盘</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/review-calendar')}
            accessibilityRole="button"
            accessibilityLabel="复盘日历"
            style={({ pressed }) => [
              styles.pageLink,
              { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.75 : 1 },
            ]}>
            <MaterialIcons name="calendar-today" size={12} color={fold.ink2} />
            <Text style={[styles.pageLinkText, { color: fold.ink2 }]}>日历</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/review-settings')}
            accessibilityRole="button"
            accessibilityLabel="复盘设置"
            style={({ pressed }) => [
              styles.pageLink,
              { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.75 : 1 },
            ]}>
            <MaterialIcons name="settings" size={12} color={fold.ink2} />
            <Text style={[styles.pageLinkText, { color: fold.ink2 }]}>设置</Text>
          </Pressable>
        </View>
          </>
        ) : null}
      </View>
    </ScrollView>
    <ReviewAiAnalysisScreen
      visible={aiOpen}
      onClose={() => setAiOpen(false)}
      scope="weekly"
      scopeLabel="周复盘"
      weekNo={weekNo}
      periodLabel={weekRangeLabel || periodStartYmd}
      weekStartYmd={periodStartYmd}
      template={weeklyTemplate}
      fields={fields}
      dailyEntries={dailyEntries}
      initialText={aiCoaching}
      canEdit={canEdit}
      onPersist={persistAiText}
    />
    </>
  );
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
    paddingTop: 6,
  },
  page: {
    width: '100%',
    paddingHorizontal: 16,
    gap: 12,
  },
  weekHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 3,
    paddingTop: 2,
  },
  weekHeadText: {
    flex: 1,
    minWidth: 0,
  },
  weekTitle: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  weekSub: {
    marginTop: 3,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  weekTag: {
    paddingTop: 4,
  },
  storyCard: {
    padding: 13,
    gap: 0,
  },
  storyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  storyKicker: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  storyMeta: {
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  statsRow: {
    marginTop: 9,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  statCell: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'flex-end',
  },
  statValue: {
    fontSize: 23,
    lineHeight: 27,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  statUnit: {
    marginTop: 1,
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    marginVertical: 3,
    marginHorizontal: 10,
  },
  timeline: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 11,
    height: StyleSheet.hairlineWidth,
  },
  timelineItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  timelineNode: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDow: {
    fontSize: 8,
    fontWeight: '600',
  },
  timelineDay: {
    fontSize: 9.5,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 5,
    marginTop: -3,
  },
  summaryText: {
    flex: 1,
    fontSize: 8.5,
    fontWeight: '500',
    letterSpacing: 0.1,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingHorizontal: 5,
  },
  noticeText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: '500',
  },
  noticeAction: {
    fontSize: 9,
    fontWeight: '700',
  },
  emptyTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  emptyText: {
    marginTop: 4,
    fontSize: 9.5,
    lineHeight: 14,
  },
  aiCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  aiRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
  },
  aiBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  aiHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  aiTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.1,
  },
  aiBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  aiBodyText: {
    fontSize: 9.5,
    lineHeight: 15,
    fontWeight: '500',
  },
  aiAction: {
    marginTop: 1,
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  primaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  primaryActionText: {
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  classicBtn: {
    minWidth: 104,
    minHeight: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
  },
  autoSave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 20,
  },
  autoSaveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  autoSaveText: {
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  pageLinks: {
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 2,
  },
  pageLink: {
    flex: 1,
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    minWidth: 0,
  },
  pageLinkText: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  pageIndex: {
    fontSize: 11,
    fontWeight: '800',
  },
});
