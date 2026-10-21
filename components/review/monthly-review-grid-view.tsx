import { ReviewGridSkeleton } from '@/components/skeletons/review';
import { FoldCard, FoldDimensionGrid, FoldSectionHeader, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { ReviewPageContent } from '@/components/review/review-shared-ui';
import { glassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { reportTabBarScroll } from '@/lib/tab-bar-auto-hide';
import {
  formatReviewMonthLabel,
  isMonthlyReviewEditable,
  monthEndYmdFromMonthStart,
  monthStartYmdFromYmd,
  rollupMonthlyFieldsFromWeeklyJournals,
  shiftMonthStartYmd,
} from '@/components/review/review-utils';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi } from '@/lib/review-ai-analysis';
import {
  collectColumnIds,
  hasAnyFilledField,
  migrateMonthlyLegacyFields,
  parseDailyReviewBody,
  parseDailyReviewJournal,
  serializeReviewBody,
  type ReviewFieldValues,
  type ReviewJournalMeta,
} from '@/lib/repositories/insights/review-journal-body';
import {
  getMonthlyReviewJournalByMonth,
  listMonthlyReviewsBetween,
  upsertMonthlyReviewJournal,
} from '@/lib/repositories/insights/monthly-review-journal';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  ensureBuiltinCascadeReviewModules,
  listReviewTemplate,
} from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  fetchReviewCatalog,
  fetchReviewJournal,
  shouldFetchReviewFromApi,
} from '@/lib/review-page-api';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type RefreshControlProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AUTO_SAVE_MS = 900;
const WEEKDAY_HEADERS = ['一', '二', '三', '四', '五', '六', '日'] as const;

function clockLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function daysInMonth(monthStartYmd: string): number {
  const parts = parseYmdParts(monthStartYmd);
  if (!parts) return 30;
  return new Date(parts.y, parts.m, 0).getDate();
}

function formatMonthTitle(monthStartYmd: string): string {
  const parts = parseYmdParts(monthStartYmd);
  if (!parts) return monthStartYmd;
  return `${parts.y} 年 ${parts.m} 月`;
}

function ymdOf(monthStartYmd: string, day: number): string {
  const parts = parseYmdParts(monthStartYmd);
  if (!parts) return monthStartYmd;
  return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dailyFillLevel(fields: ReviewFieldValues): number {
  const values = Object.values(fields)
    .map(v => (v ?? '').trim())
    .filter(Boolean);
  if (values.length === 0) return 0;
  const chars = values.join('').length;
  if (values.length >= 6 || chars >= 240) return 4;
  if (values.length >= 4) return 3;
  if (values.length >= 2) return 2;
  return 1;
}

export function MonthlyReviewGridView({
  pageApiKey,
  refreshControl,
  onRegisterReload,
  onMonthLabelChange,
}: {
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onRegisterReload?: (reload: () => Promise<void>) => void;
  onMonthLabelChange?: (label: string) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { fold } = useFoldTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [monthStartYmd, setMonthStartYmd] = useState(() => monthStartYmdFromYmd(todayYmd));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [monthlyTemplate, setMonthlyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [dailyEntries, setDailyEntries] = useState<Array<{ ymd: string; fields: ReviewFieldValues }>>([]);
  const [filledMonthKeys, setFilledMonthKeys] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const hydratedRef = useRef(false);
  const skipFirstFocusReloadRef = useRef(true);
  const lastPersistedBodyRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = isMonthlyReviewEditable(monthStartYmd, todayYmd);
  const currentMonthStart = monthStartYmdFromYmd(todayYmd);
  const canGoNext = monthStartYmd < currentMonthStart;
  const monthLabel = formatReviewMonthLabel(monthStartYmd);
  const monthParts = parseYmdParts(monthStartYmd);
  const monthNumber = monthParts?.m ?? 1;
  const totalDays = daysInMonth(monthStartYmd);

  useEffect(() => {
    onMonthLabelChange?.(monthLabel);
  }, [monthLabel, onMonthLabelChange]);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    hydratedRef.current = false;
    if (!silent) setLoading(true);
    try {
      await wrapLoad(async () => {
        await ensureBuiltinCascadeReviewModules();
        const monthEnd = monthEndYmdFromMonthStart(monthStartYmd);
        const historyStart = shiftMonthStartYmd(monthStartYmd, -11);
        if (shouldFetchReviewFromApi()) {
          await Promise.all([
            fetchReviewCatalog({ scope: 'monthly' }),
            fetchReviewCatalog({ scope: 'weekly' }),
            fetchReviewJournal({ scope: 'monthly', start: historyStart, end: monthEnd }),
            fetchReviewJournal({
              scope: 'weekly',
              start: monthStartYmd,
              end: monthEnd,
            }),
            fetchReviewJournal({
              scope: 'daily',
              start: monthStartYmd,
              end: monthEnd,
            }),
          ]);
        }
        const [tpl, row, dailyTpl, dailyRows, monthlyRows] = await Promise.all([
          listReviewTemplate('monthly'),
          getMonthlyReviewJournalByMonth(monthStartYmd),
          listReviewTemplate('daily'),
          listDailyReviewsBetween(monthStartYmd, monthEnd),
          listMonthlyReviewsBetween(historyStart, monthEnd),
        ]);
        setMonthlyTemplate(tpl);
        const colIds = collectColumnIds(tpl);
        const journal = parseDailyReviewJournal(row?.body ?? null, colIds);
        const migrated = migrateMonthlyLegacyFields(journal.fields, row?.body);
        const fieldsWithRollup = await rollupMonthlyFieldsFromWeeklyJournals(migrated, monthStartYmd);
        setFields(fieldsWithRollup);
        setMeta(journal.meta);
        lastPersistedBodyRef.current = serializeReviewBody(migrated, journal.meta);

        const dailyColIds = collectColumnIds(dailyTpl);
        setDailyEntries(
          dailyRows.map(dailyRow => ({
            ymd: dailyRow.record_date_ymd,
            fields: parseDailyReviewBody(dailyRow.body ?? '', dailyColIds),
          })),
        );

        const filledMonths = new Set<string>();
        for (const monthlyRow of monthlyRows) {
          const monthFields = parseDailyReviewBody(monthlyRow.body ?? '', colIds);
          if (hasAnyFilledField(monthFields)) {
            filledMonths.add(monthStartYmdFromYmd(monthlyRow.month_start_ymd));
          }
        }
        if (hasAnyFilledField(fieldsWithRollup)) filledMonths.add(monthStartYmd);
        setFilledMonthKeys(filledMonths);
      });
    } catch {
      setFields({});
      setMeta({});
      setMonthlyTemplate([]);
      setDailyEntries([]);
      setFilledMonthKeys(new Set());
      lastPersistedBodyRef.current = null;
    } finally {
      setLoading(false);
      hydratedRef.current = true;
    }
  }, [monthStartYmd, wrapLoad]);

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
    if (!canEdit) return;
    const body = serializeReviewBody(fields, meta);
    if (body === lastPersistedBodyRef.current) return;
    setSaving(true);
    try {
      await upsertMonthlyReviewJournal(monthStartYmd, body);
      lastPersistedBodyRef.current = body;
      setLastSavedAt(clockLabel(new Date()));
    } catch (e) {
      console.warn('monthly review save', e);
      toast.error(toUserMessage(e, '复盘保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [canEdit, fields, meta, monthStartYmd]);

  useEffect(() => {
    if (!hydratedRef.current || !canEdit) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persist();
    }, AUTO_SAVE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [canEdit, fields, meta, persist]);

  const openDimension = useCallback(
    (dimensionId: string) => {
      router.push(`/monthly-review/${monthStartYmd}/${dimensionId}` as never);
    },
    [monthStartYmd, router],
  );

  const runAi = useCallback(async () => {
    if (!canEdit) {
      Alert.alert('暂不可用', '未来月份仅可查看，不可生成 AI 分析。');
      return;
    }
    if (!reviewHasEnoughTextForAi(fields)) {
      Alert.alert('内容偏少', '请先填写至少约 30 字，再生成 AI 分析。');
      return;
    }
    setAiBusy(true);
    try {
      await persist();
      const text = await generateReviewAiAnalysis({
        scope: 'monthly',
        periodLabel: monthLabel,
        template: monthlyTemplate,
        fields,
      });
      const nextMeta = { ...meta, ai_analysis: text };
      setMeta(nextMeta);
      setAiExpanded(true);
      const body = serializeReviewBody(fields, nextMeta);
      await upsertMonthlyReviewJournal(monthStartYmd, body);
      lastPersistedBodyRef.current = body;
      setLastSavedAt(clockLabel(new Date()));
    } catch (e) {
      console.warn('monthly ai analysis', e);
      toast.error(toUserMessage(e, '分析失败，请稍后重试'));
    } finally {
      setAiBusy(false);
    }
  }, [canEdit, fields, meta, monthLabel, monthStartYmd, monthlyTemplate, persist]);

  const heatCells = useMemo(() => {
    const levelByYmd = new Map<string, number>();
    for (const entry of dailyEntries) {
      levelByYmd.set(entry.ymd, dailyFillLevel(entry.fields));
    }
    const first = new Date(monthParts?.y ?? 2026, (monthParts?.m ?? 1) - 1, 1);
    const leading = (first.getDay() + 6) % 7;
    const cells: Array<{ key: string; ymd?: string; day?: number; level: number; future: boolean; today: boolean }> = [];
    for (let i = 0; i < leading; i++) cells.push({ key: `lead-${i}`, level: -1, future: false, today: false });
    for (let day = 1; day <= totalDays; day++) {
      const ymd = ymdOf(monthStartYmd, day);
      cells.push({
        key: ymd,
        ymd,
        day,
        level: levelByYmd.get(ymd) ?? 0,
        future: ymd > todayYmd,
        today: ymd === todayYmd,
      });
    }
    while (cells.length % 7 !== 0) {
      cells.push({ key: `tail-${cells.length}`, level: -1, future: false, today: false });
    }
    const rows: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  }, [dailyEntries, monthParts, monthStartYmd, todayYmd, totalDays]);

  const reviewedDays = useMemo(
    () => dailyEntries.reduce((count, entry) => count + (dailyFillLevel(entry.fields) > 0 ? 1 : 0), 0),
    [dailyEntries],
  );

  const completionRate = useMemo(() => {
    const parts = parseYmdParts(todayYmd);
    const startParts = parseYmdParts(monthStartYmd);
    if (!parts || !startParts) return 0;
    const isCurrent = parts.y === startParts.y && parts.m === startParts.m;
    const isFuture = monthStartYmd > currentMonthStart;
    if (isFuture) return 0;
    const denominator = isCurrent ? parts.d : totalDays;
    if (denominator <= 0) return 0;
    return Math.min(100, Math.round((reviewedDays / denominator) * 100));
  }, [todayYmd, monthStartYmd, currentMonthStart, totalDays, reviewedDays]);

  const monthStreak = useMemo(() => {
    let cursor = filledMonthKeys.has(monthStartYmd)
      ? monthStartYmd
      : shiftMonthStartYmd(monthStartYmd, -1);
    let streak = 0;
    for (let i = 0; i < 24; i++) {
      if (!filledMonthKeys.has(cursor)) break;
      streak += 1;
      cursor = shiftMonthStartYmd(cursor, -1);
    }
    return streak;
  }, [filledMonthKeys, monthStartYmd]);

  const badgeText =
    completionRate >= 80
      ? '稳步生长'
      : completionRate >= 50
        ? '渐入佳境'
        : reviewedDays > 0
          ? '正在积累'
          : '等待记录';

  const aiText = (meta.ai_analysis ?? '').trim();
  const cellGap = 3;
  const contentMaxWidth = Math.min(width, 460);
  const heatCellSize = Math.floor((contentMaxWidth - 32 - 32 - cellGap * 6) / 7);
  const heatLevelColors = [fold.heat0, fold.heat1, fold.heat2, fold.heat3, fold.heat4];

  if (loading) {
    return <ReviewGridSkeleton />;
  }

  return (
    <ScrollView
      style={{ backgroundColor: fold.paper }}
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: 32 + glassTabBarContentInset(insets.bottom), backgroundColor: fold.paper },
      ]}
      onScroll={e => reportTabBarScroll(e.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}>
      <ReviewPageContent style={styles.pageGap}>
        <View style={styles.monthTitleRow}>
          <View style={styles.monthTitleCopy}>
            <Text style={[styles.monthTitle, { color: fold.pine }]} maxFontSizeMultiplier={1.25}>
              {formatMonthTitle(monthStartYmd)}
            </Text>
            <Text style={[styles.monthDays, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
              {totalDays} 天
            </Text>
          </View>
          <View style={styles.monthNav}>
            <Pressable
              onPress={() => setMonthStartYmd(prev => shiftMonthStartYmd(prev, -1))}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="上个月"
              style={({ pressed }) => [
                styles.navIconBtn,
                { borderColor: fold.line, backgroundColor: fold.cardSoft, opacity: pressed ? 0.7 : 1 },
              ]}>
              <MaterialIcons name="chevron-left" size={20} color={fold.muted} />
            </Pressable>
            <Pressable
              onPress={() => setMonthStartYmd(currentMonthStart)}
              disabled={monthStartYmd === currentMonthStart}
              accessibilityRole="button"
              accessibilityLabel="回到本月"
              accessibilityState={{ disabled: monthStartYmd === currentMonthStart }}
              style={({ pressed }) => [
                styles.navMonthPill,
                {
                  borderColor: fold.line,
                  backgroundColor: fold.cardSoft,
                  opacity: monthStartYmd === currentMonthStart ? 0.55 : pressed ? 0.8 : 1,
                },
              ]}>
              <Text style={[styles.navMonthText, { color: fold.ink2 }]}>本月</Text>
            </Pressable>
            <Pressable
              onPress={() => setMonthStartYmd(prev => shiftMonthStartYmd(prev, 1))}
              disabled={!canGoNext}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="下个月"
              accessibilityState={{ disabled: !canGoNext }}
              style={({ pressed }) => [
                styles.navIconBtn,
                {
                  borderColor: fold.line,
                  backgroundColor: fold.cardSoft,
                  opacity: !canGoNext ? 0.3 : pressed ? 0.7 : 1,
                },
              ]}>
              <MaterialIcons name="chevron-right" size={20} color={fold.muted} />
            </Pressable>
          </View>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: fold.summaryBg }]}>
          <View style={[styles.summaryOrb, styles.summaryOrbA]} />
          <View style={[styles.summaryOrb, styles.summaryOrbB]} />
          <View style={styles.summaryTop}>
            <Text style={[styles.summaryEyebrow, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.2}>
              MONTH IN REVIEW · {monthNumber} 月的折页
            </Text>
            <View
              style={[
                styles.summaryBadge,
                { backgroundColor: fold.badgeBg, borderColor: fold.badgeBorder },
              ]}>
              <MaterialIcons name="auto-awesome" size={11} color={fold.badgeText} />
              <Text style={[styles.summaryBadgeText, { color: fold.badgeText }]} maxFontSizeMultiplier={1.15}>
                {badgeText}
              </Text>
            </View>
          </View>
          <View style={styles.summaryStats}>
            <View style={styles.summaryStat}>
              <Text style={[styles.summaryValue, { color: fold.summaryText }]} maxFontSizeMultiplier={1.2}>
                {reviewedDays}
              </Text>
              <Text style={[styles.summaryLabel, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.15}>
                天已复盘
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: fold.summaryLine }]} />
            <View style={styles.summaryStat}>
              <Text style={[styles.summaryValue, { color: fold.summaryText }]} maxFontSizeMultiplier={1.2}>
                {monthStreak}
              </Text>
              <Text style={[styles.summaryLabel, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.15}>
                个月连续
              </Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: fold.summaryLine }]} />
            <View style={styles.summaryStat}>
              <Text style={[styles.summaryValue, { color: fold.summaryText }]} maxFontSizeMultiplier={1.2}>
                {completionRate}%
              </Text>
              <Text style={[styles.summaryLabel, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.15}>
                完成率
              </Text>
            </View>
          </View>
        </View>

        {!canEdit ? (
          <FoldCard style={styles.noticeCard}>
            <MaterialIcons name="lock-clock" size={18} color={fold.amber} />
            <Text style={[styles.noticeText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
              未来月份仅可查看，暂不可填写与生成分析。
            </Text>
          </FoldCard>
        ) : null}

        <FoldCard style={styles.heatCard}>
          <View style={styles.heatTop}>
            <Text style={[styles.cardTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.25}>
              {monthNumber}月记录热力
            </Text>
            <Text style={[styles.cardHint, { color: fold.muted }]} maxFontSizeMultiplier={1.15}>
              颜色越深，记录越完整
            </Text>
          </View>
          <View style={styles.weekdayRow}>
            {WEEKDAY_HEADERS.map(label => (
              <Text key={label} style={[styles.weekdayText, { color: fold.muted }]} maxFontSizeMultiplier={1.1}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.heatGrid}>
            {heatCells.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={[styles.heatRow, { gap: cellGap }]}>
                {row.map(cell => (
                  <View
                    key={cell.key}
                    accessibilityLabel={
                      cell.day != null
                        ? `${monthNumber}月${cell.day}日，${cell.future ? '未来日期' : cell.level > 0 ? '已复盘' : '未复盘'}`
                        : undefined
                    }
                    style={[
                      styles.heatCell,
                      {
                        width: heatCellSize,
                        height: heatCellSize,
                        borderRadius: Math.max(3, Math.round(heatCellSize * 0.18)),
                        backgroundColor:
                          cell.level < 0
                            ? 'transparent'
                            : cell.future
                              ? fold.paper
                              : heatLevelColors[Math.max(0, Math.min(4, cell.level))],
                        borderWidth: cell.today ? 1.5 : 0,
                        borderColor: fold.pine,
                        opacity: cell.future ? 0.6 : 1,
                      },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
          <View style={styles.heatLabels}>
            {['01', '08', '15', '22', '29'].map((day, index) => (
              <Text key={day} style={[styles.heatLabel, { color: fold.muted }]} maxFontSizeMultiplier={1.1}>
                {index === 0 ? `${monthNumber}.${day}` : day}
              </Text>
            ))}
          </View>
        </FoldCard>

        <View style={styles.dimensionSection}>
          <FoldSectionHeader title="月度维度" hint="空栏已汇总本月各周复盘" />
          {monthlyTemplate.length === 0 ? (
            <FoldCard style={styles.emptyCard}>
              <MaterialIcons name="dashboard-customize" size={22} color={fold.muted} />
              <Text style={[styles.emptyTitle, { color: fold.ink }]}>尚未配置月复盘维度</Text>
              <Text style={[styles.emptyHint, { color: fold.muted }]}>
                请前往复盘模板设置，为月复盘添加维度与栏目。
              </Text>
              <Pressable
                onPress={() => router.push('/review-template-settings?scope=monthly')}
                style={({ pressed }) => [
                  styles.emptyBtn,
                  { backgroundColor: fold.pineButton, opacity: pressed ? 0.9 : 1 },
                ]}>
                <Text style={[styles.emptyBtnText, { color: fold.onPineButton }]}>去模板设置</Text>
              </Pressable>
            </FoldCard>
          ) : (
            <FoldDimensionGrid
              scope="monthly"
              dimensions={monthlyTemplate}
              fields={fields}
              canEdit={canEdit}
              onOpenDimension={openDimension}
            />
          )}
        </View>

        <View style={[styles.aiCard, { backgroundColor: fold.aiBg, borderColor: fold.aiBorder }]}>
          <View style={styles.aiHead}>
            <View style={[styles.aiOrb, { backgroundColor: fold.pineButton }]}>
              <MaterialIcons name="auto-awesome" size={14} color={fold.badgeText} />
            </View>
            <Text style={[styles.aiTitle, { color: fold.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
              月 AI 分析
            </Text>
            <Pressable
              onPress={() => void runAi()}
              disabled={aiBusy || !canEdit}
              accessibilityRole="button"
              accessibilityLabel={aiText ? '重新生成月 AI 分析' : '生成月 AI 分析'}
              style={({ pressed }) => [
                styles.aiAction,
                { borderColor: fold.aiBorder, opacity: aiBusy || !canEdit ? 0.45 : pressed ? 0.75 : 1 },
              ]}>
              {aiBusy ? (
                <ActivityIndicator size="small" color={fold.aiInk} />
              ) : (
                <Text style={[styles.aiActionText, { color: fold.aiInk }]}>{aiText ? '重新生成' : '生成分析'}</Text>
              )}
            </Pressable>
          </View>

          {aiBusy && !aiText ? (
            <View style={styles.aiSkeleton}>
              {[100, 88, 72].map((pct, index) => (
                <View key={index} style={[styles.aiSkeletonLine, { width: `${pct}%`, backgroundColor: fold.line }]} />
              ))}
            </View>
          ) : aiText ? (
            <Text
              style={[styles.aiBody, { color: fold.ink2 }]}
              numberOfLines={aiExpanded ? undefined : 3}
              maxFontSizeMultiplier={1.4}>
              {aiText}
            </Text>
          ) : (
            <Text style={[styles.aiHint, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
              汇总本月各周复盘后，可生成一段对本月节奏的回看与建议。
            </Text>
          )}

          {aiText ? (
            <Pressable
              onPress={() => setAiExpanded(v => !v)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityState={{ expanded: aiExpanded }}
              style={styles.aiLink}>
              <Text style={[styles.aiLinkText, { color: fold.aiInk }]} maxFontSizeMultiplier={1.2}>
                {aiExpanded ? '收起完整分析' : '展开完整分析并写入 meta.ai_analysis'}
              </Text>
              <MaterialIcons name={aiExpanded ? 'expand-less' : 'chevron-right'} size={14} color={fold.aiInk} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.footerStatus}>
          <View style={[styles.footerDot, { backgroundColor: saving ? fold.amber : fold.sage }]} />
          <Text style={[styles.footerText, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
            {saving ? '正在保存…' : lastSavedAt ? `已自动保存 · ${lastSavedAt}` : '尚未保存 · 输入后将自动保存'}
          </Text>
        </View>
      </ReviewPageContent>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
    paddingTop: 8,
  },
  pageGap: {
    gap: 12,
    paddingHorizontal: 16,
  },
  monthTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    paddingTop: 4,
  },
  monthTitleCopy: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexShrink: 1,
  },
  monthTitle: {
    fontSize: 25,
    lineHeight: 33,
    fontWeight: '600',
    fontFamily: foldFonts.serif,
    letterSpacing: 0.3,
  },
  monthDays: { fontSize: 11, fontWeight: '600' },
  monthNav: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  navIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navMonthPill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navMonthText: { fontSize: 11.5, fontWeight: '700' },
  summaryCard: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 16,
    overflow: 'hidden',
  },
  summaryOrb: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  summaryOrbA: { width: 150, height: 150, right: -62, bottom: -86 },
  summaryOrbB: { width: 110, height: 110, right: -20, top: -58 },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryEyebrow: { fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },
  summaryBadge: {
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  summaryBadgeText: { fontSize: 9.5, fontWeight: '700' },
  summaryStats: { flexDirection: 'row', alignItems: 'center' },
  summaryStat: { flex: 1, gap: 2 },
  summaryValue: { fontSize: 30, lineHeight: 36, fontWeight: '600', fontFamily: foldFonts.mono },
  summaryLabel: { fontSize: 10, fontWeight: '600' },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 32, marginRight: 14 },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 12,
  },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18 },
  heatCard: { gap: 9 },
  heatTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  cardHint: { fontSize: 10.5 },
  weekdayRow: { flexDirection: 'row', gap: 3 },
  weekdayText: { flex: 1, fontSize: 9, fontWeight: '600', textAlign: 'center' },
  heatGrid: { gap: 3 },
  heatRow: { flexDirection: 'row' },
  heatCell: {},
  heatLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 1 },
  heatLabel: { fontSize: 9, fontWeight: '500' },
  dimensionSection: { gap: 8, marginTop: 2 },
  emptyCard: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyTitle: { fontSize: 15, fontWeight: '800' },
  emptyHint: { fontSize: 12, lineHeight: 18, textAlign: 'center' },
  emptyBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18, marginTop: 4 },
  emptyBtnText: { fontSize: 12.5, fontWeight: '800' },
  aiCard: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
    marginTop: 2,
  },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiOrb: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  aiTitle: { flex: 1, fontSize: 12.5, fontWeight: '800' },
  aiAction: {
    height: 26,
    minWidth: 64,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiActionText: { fontSize: 10, fontWeight: '700' },
  aiSkeleton: { gap: 6, paddingVertical: 2 },
  aiSkeletonLine: { height: 10, borderRadius: 5 },
  aiBody: { fontSize: 12.5, lineHeight: 20 },
  aiHint: { fontSize: 12, lineHeight: 19 },
  aiLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 },
  aiLinkText: { fontSize: 10.5, fontWeight: '700' },
  footerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 2,
  },
  footerDot: { width: 5, height: 5, borderRadius: 3 },
  footerText: { fontSize: 10.5 },
});
