import {
  countEditableDailyEntries,
  countFilledDailyEntries,
  dailyEntryHasContent,
  loadReviewPeriodSnapshot,
  rollupWeeklyFieldsFromDailyEntries,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/components/review/review-utils';
import { FoldCard, FoldSwitch, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { generateWeeklyReviewCoaching, weeklyReviewHasEnoughText } from '@/lib/weekly-review-coaching';
import {
  buildDailyDigest,
  collectColumnIds,
  emptyFieldValues,
  parseWeeklyReviewFields,
  previewTextFromFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { builtinReviewColumnId } from '@/lib/repositories/insights/review-template-defaults';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  fetchWeeklyReviewMetrics,
  getRollingSevenDayRangeEndingOnNextReviewDay,
} from '@/lib/repositories/insights/weekly-review';
import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewJournalByWeek,
  setWeeklyReviewCoachingText,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { isDailyReviewSkippedOnWeeklyReviewDay } from '@/lib/weekly-review-settings';
import { resetPageApiSession, shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'weekly-review-form';
const AUTO_SAVE_MS = 900;

function clockLabel(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function isoWeekNumber(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function compactMonthDay(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${Number(m[2])}.${m[3]}`;
}

function monthDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return ymd;
  return `${Number(m[2])}/${m[3]}`;
}

function weekdayOfYmd(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

const SCORE_NOTES: Record<number, { label: string; hint: string }> = {
  0: { label: '凭第一直觉选择。', hint: '不需要完美，只是一个坐标。' },
  1: { label: '这周有些偏离。', hint: '先把自己接住，下周只挑一件要紧事。' },
  2: { label: '略显吃力。', hint: '把范围缩小一点，先完成一件。' },
  3: { label: '稳住了这一周。', hint: '没有大起大落，也是一种进展。' },
  4: { label: '略疲惫，但稳定。', hint: '关键事项都收口了，留白比上周多。' },
  5: { label: '完成得漂亮。', hint: '把这次的好节奏记下来，下周沿用。' },
};

export function WeeklyReviewFormScreen({
  embedded = false,
  pageApiKey,
  refreshControl: externalRefreshControl,
  onRegisterReload,
}: {
  embedded?: boolean;
  pageApiKey?: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onRegisterReload?: (reload: () => Promise<void>) => void;
} = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const apiKey = pageApiKey ?? PAGE_API_KEY;
  const { fold } = useFoldTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(apiKey);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [dailyReviewsOpen, setDailyReviewsOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [periodStartYmd, setPeriodStartYmd] = useState('');
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [metrics, setMetrics] = useState<WeeklyReviewMetrics | null>(null);
  const [dailyTemplate, setDailyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [weeklyTemplate, setWeeklyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [dailyEntries, setDailyEntries] = useState<Awaited<ReturnType<typeof loadReviewPeriodSnapshot>>['dailyEntries']>([]);
  const [weeklyFields, setWeeklyFields] = useState<ReviewFieldValues>({});
  const [executionScore, setExecutionScore] = useState(0);
  const [aiCoaching, setAiCoaching] = useState<string | null>(null);
  const [adjustTasks, setAdjustTasks] = useState(false);
  const [adjustSavings, setAdjustSavings] = useState(false);
  const [adjustPlans, setAdjustPlans] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleDailyRefs = useCallback(() => {
    setDailyReviewsOpen(v => !v);
  }, []);

  const toggleMetricsRefs = useCallback(() => {
    setMetricsOpen(v => !v);
  }, []);

  const reload = useCallback(
    async (forceRefresh = false) => {
      hydratedRef.current = false;
      setLoading(true);
      try {
        await wrapLoad(async () => {
          const [snapshot, weeklyTpl] = await Promise.all([
            loadReviewPeriodSnapshot(todayYmd),
            listReviewTemplate('weekly'),
          ]);
          setConfiguredDow(snapshot.configuredDow);
          setCanEdit(snapshot.canEditWeekly);
          setWeekRangeLabel(snapshot.weekRangeLabel);
          setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);
          setDailyTemplate(snapshot.dailyTemplate);
          setDailyEntries(snapshot.dailyEntries);
          setWeeklyTemplate(weeklyTpl);
          const wColIds = collectColumnIds(weeklyTpl);

          const today = new Date();
          const rolling =
            snapshot.configuredDow !== null
              ? getRollingSevenDayRangeEndingOnNextReviewDay(today, snapshot.configuredDow)
              : null;
          const metricsAnchor = rolling
            ? new Date(rolling.end.getFullYear(), rolling.end.getMonth(), rolling.end.getDate())
            : today;
          const weekStart = snapshot.periodStartYmd || rolling?.startYmd || '';

          if (!snapshot.canEditWeekly || !weekStart) {
            setPeriodStartYmd('');
            setMetrics(null);
            const previewRow = weekStart ? await getWeeklyReviewJournalByWeek(weekStart) : null;
            const base = previewRow
              ? parseWeeklyReviewFields(previewRow, wColIds)
              : emptyFieldValues(wColIds);
            setWeeklyFields(
              rollupWeeklyFieldsFromDailyEntries(
                base,
                snapshot.dailyEntries,
                snapshot.reviewCycleEndYmd,
                snapshot.configuredDow,
              ),
            );
            setExecutionScore(0);
            setAiCoaching(null);
            setAdjustTasks(false);
            setAdjustSavings(false);
            setAdjustPlans(false);
            return;
          }

          setPeriodStartYmd(weekStart);
          const [row, m] = await Promise.all([
            getWeeklyReviewJournalByWeek(weekStart),
            fetchWeeklyReviewMetrics(metricsAnchor, 'rolling-7'),
          ]);
          setMetrics(m);
          const base = row ? parseWeeklyReviewFields(row, wColIds) : emptyFieldValues(wColIds);
          setWeeklyFields(
            rollupWeeklyFieldsFromDailyEntries(
              base,
              snapshot.dailyEntries,
              snapshot.reviewCycleEndYmd,
              snapshot.configuredDow,
            ),
          );
          if (row) {
            setExecutionScore(row.execution_score > 0 ? row.execution_score : 0);
            setAiCoaching(row.ai_coaching);
            setAdjustTasks(row.adjust_tasks === 1);
            setAdjustSavings(row.adjust_savings === 1);
            setAdjustPlans(row.adjust_plans === 1);
          } else {
            setExecutionScore(0);
            setAiCoaching(null);
            setAdjustTasks(false);
            setAdjustSavings(false);
            setAdjustPlans(false);
          }
        }, forceRefresh);
      } catch {
        setMetrics(null);
      } finally {
        setLoading(false);
        hydratedRef.current = true;
      }
    },
    [todayYmd, wrapLoad],
  );

  const { refreshControl: internalRefreshControl } = usePagePullRefresh(
    embedded && externalRefreshControl ? `${apiKey}-weekly` : apiKey,
    reload,
  );
  const refreshControl = externalRefreshControl ?? internalRefreshControl;

  useEffect(() => {
    if (!embedded || !onRegisterReload) return;
    onRegisterReload(reload);
    return () => onRegisterReload(async () => {});
  }, [embedded, onRegisterReload, reload]);

  useFocusEffect(
    useCallback(() => {
      if (shouldSkipPageFocusApiRefresh(apiKey)) {
        setLoading(false);
        return;
      }
      void reload();
    }, [apiKey, reload]),
  );

  useEffect(() => {
    if (embedded) return;
    return () => resetPageApiSession(apiKey);
  }, [apiKey, embedded]);

  const persistDraft = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      await upsertWeeklyReviewJournal({
        week_start_ymd: periodStartYmd,
        fields: weeklyFields,
        execution_score: executionScore,
        adjust_tasks: adjustTasks,
        adjust_savings: adjustSavings,
        adjust_plans: adjustPlans,
      });
      setLastSavedAt(clockLabel(new Date()));
      return true;
    } catch (e) {
      console.warn('weekly review save', e);
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [periodStartYmd, weeklyFields, executionScore, adjustTasks, adjustSavings, adjustPlans]);

  useEffect(() => {
    if (!hydratedRef.current || !canEdit || !periodStartYmd) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      void persistDraft();
    }, AUTO_SAVE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [canEdit, periodStartYmd, weeklyFields, executionScore, adjustTasks, adjustSavings, adjustPlans, persistDraft]);

  const onSaveDraft = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可保存', '仅在已设定的「每周复盘日」当天可填写与保存；请先设置复盘日，并在对应日期打开本页。');
      return;
    }
    const ok = await persistDraft();
    if (ok) toast.success('已保存');
  }, [canEdit, periodStartYmd, persistDraft]);

  const setWeeklyField = useCallback((columnId: string, value: string) => {
    setWeeklyFields(prev => ({ ...prev, [columnId]: value }));
  }, []);

  const visibleDailyEntries = useMemo(
    () => dailyEntries.filter(e => !isDailyReviewSkippedOnWeeklyReviewDay(e.ymd, reviewCycleEndYmd, configuredDow)),
    [dailyEntries, reviewCycleEndYmd, configuredDow],
  );

  const dailyFilledCount = useMemo(
    () => countFilledDailyEntries(dailyEntries, reviewCycleEndYmd, configuredDow),
    [dailyEntries, reviewCycleEndYmd, configuredDow],
  );

  const dailyEditableCount = useMemo(
    () => countEditableDailyEntries(dailyEntries, reviewCycleEndYmd, configuredDow, todayYmd),
    [dailyEntries, reviewCycleEndYmd, configuredDow, todayYmd],
  );

  const filledDailyEntries = useMemo(
    () => visibleDailyEntries.filter(e => dailyEntryHasContent(e.fields)),
    [visibleDailyEntries],
  );

  const dailyDigest = useMemo(
    () => buildDailyDigest(filledDailyEntries, dailyTemplate),
    [filledDailyEntries, dailyTemplate],
  );

  const onGenerateAi = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可用', '仅在复盘日当天可生成 AI 建议。');
      return;
    }
    if (executionScore < 1 || executionScore > 5) {
      Alert.alert('请先自评', '请为「本周期执行结果」选择 1～5 星后再生成建议。');
      return;
    }
    if (!weeklyReviewHasEnoughText(weeklyTemplate, weeklyFields)) {
      Alert.alert('多写一点', '每个板块哪怕几句话，也能让建议更贴近你；当前文字略少。');
      return;
    }
    setAiBusy(true);
    try {
      const saved = await persistDraft();
      if (!saved) return;
      const coaching = await generateWeeklyReviewCoaching({
        weekRangeLabel,
        template: weeklyTemplate,
        fields: weeklyFields,
        executionScore,
        metrics,
        dailyReviewsDigest: dailyDigest,
      });
      await setWeeklyReviewCoachingText(periodStartYmd, coaching);
      setAiCoaching(coaching);
    } catch (e) {
      console.warn('weekly review ai', e);
      toast.error(toUserMessage(e, '生成失败，请检查网络后重试'));
    } finally {
      setAiBusy(false);
    }
  }, [
    executionScore,
    weeklyFields,
    weeklyTemplate,
    weekRangeLabel,
    metrics,
    periodStartYmd,
    persistDraft,
    canEdit,
    dailyDigest,
  ]);

  const allDailyColumns = useMemo(
    () => dailyTemplate.flatMap(d => d.columns),
    [dailyTemplate],
  );

  const isDailySkipped = useCallback(
    (ymd: string) => isDailyReviewSkippedOnWeeklyReviewDay(ymd, reviewCycleEndYmd, configuredDow),
    [reviewCycleEndYmd, configuredDow],
  );

  const goDailyReview = useCallback(
    (ymd: string) => router.push({ pathname: '/daily-review/[ymd]', params: { ymd } }),
    [router],
  );

  const onCopyDailyDigest = useCallback(async () => {
    if (!dailyDigest.trim()) {
      Alert.alert('暂无内容', '本周期还没有已填写的日复盘。');
      return;
    }
    await Clipboard.setStringAsync(dailyDigest);
    Alert.alert('已复制', '本周期日复盘摘要已复制到剪贴板，可粘贴到周复盘任一栏目。');
  }, [dailyDigest]);

  const onInsertDailyDigest = useCallback(() => {
    if (!dailyDigest.trim()) {
      Alert.alert('暂无内容', '本周期还没有已填写的日复盘。');
      return;
    }
    const colIds = collectColumnIds(weeklyTemplate);
    const targetId = colIds.find(id => !(weeklyFields[id] ?? '').trim());
    if (!targetId) {
      Alert.alert('栏目已满', '所有周复盘栏目都已有内容；你可以使用「复制摘要」后手动粘贴到需要的位置。');
      return;
    }
    let colTitle = targetId;
    for (const dim of weeklyTemplate) {
      const col = dim.columns.find(c => c.id === targetId);
      if (col) {
        colTitle = col.title;
        break;
      }
    }
    const existing = (weeklyFields[targetId] ?? '').trim();
    const next = existing ? `${existing}\n\n---\n\n${dailyDigest}` : dailyDigest;
    setWeeklyFields(prev => ({ ...prev, [targetId]: next }));
    Alert.alert('已插入', `已将本周期日复盘摘要插入到「${colTitle}」。`);
  }, [dailyDigest, weeklyFields, weeklyTemplate]);

  const weeklyColumnIds = useMemo(() => collectColumnIds(weeklyTemplate), [weeklyTemplate]);

  const quoteColumnId = useMemo(() => {
    const columns = weeklyTemplate.flatMap(d => d.columns);
    if (columns.length === 0) return null;
    const ideasId = builtinReviewColumnId('weekly', 'ideas');
    return (
      columns.find(c => c.id === ideasId)?.id ??
      columns.find(c => /想法|一句话|收获/.test(c.title))?.id ??
      columns[columns.length - 1].id
    );
  }, [weeklyTemplate]);

  const detailDimensions = useMemo(() => {
    if (!quoteColumnId) return weeklyTemplate;
    return weeklyTemplate
      .map(dim => ({ ...dim, columns: dim.columns.filter(col => col.id !== quoteColumnId) }))
      .filter(dim => dim.columns.length > 0);
  }, [weeklyTemplate, quoteColumnId]);

  const filledFieldCount = useMemo(
    () => weeklyColumnIds.filter(id => (weeklyFields[id] ?? '').trim().length > 0).length,
    [weeklyColumnIds, weeklyFields],
  );

  const aiReady = useMemo(
    () => executionScore >= 1 && weeklyReviewHasEnoughText(weeklyTemplate, weeklyFields),
    [executionScore, weeklyTemplate, weeklyFields],
  );

  const weekSubtitle = useMemo(() => {
    const anchor = periodStartYmd || todayYmd;
    const weekNo = isoWeekNumber(anchor);
    const first = dailyEntries[0]?.ymd;
    const last = dailyEntries[dailyEntries.length - 1]?.ymd;
    const compact = first && last ? `${compactMonthDay(first)}–${compactMonthDay(last)}` : weekRangeLabel;
    return weekNo ? `第 ${weekNo} 周 · ${compact}` : compact;
  }, [periodStartYmd, todayYmd, dailyEntries, weekRangeLabel]);

  const scoreNote = SCORE_NOTES[executionScore] ?? SCORE_NOTES[0];

  const dayDots = useMemo(
    () =>
      dailyEntries.map(entry => {
        const skipped = isDailySkipped(entry.ymd);
        const filled = !skipped && dailyEntryHasContent(entry.fields);
        const today = entry.ymd === todayYmd;
        const dow = weekdayOfYmd(entry.ymd);
        return {
          ymd: entry.ymd,
          label: WEEKLY_REVIEW_WEEKDAY_LABELS[dow].slice(-1),
          skipped,
          filled,
          today,
        };
      }),
    [dailyEntries, isDailySkipped, todayYmd],
  );

  const referenceEntries = useMemo(
    () => (dailyReviewsOpen ? filledDailyEntries : filledDailyEntries.slice(-3)),
    [dailyReviewsOpen, filledDailyEntries],
  );

  const editableDayTotal = dailyEditableCount > 0 ? dailyEditableCount : Math.max(visibleDailyEntries.length, 1);

  const quoteValue = quoteColumnId ? weeklyFields[quoteColumnId] ?? '' : '';

  const body = (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, embedded && styles.scrollEmbedded, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}>
          {!canEdit ? (
            <FoldCard style={styles.gateCard}>
              <View style={[styles.gateIcon, { backgroundColor: fold.amber2 }]}>
                <MaterialIcons name="lock-clock" size={22} color={fold.amber} />
              </View>
              <Text style={[styles.gateTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.4}>
                {configuredDow === null ? '请先设置每周复盘日' : '今天不是复盘日'}
              </Text>
              <Text style={[styles.gateBody, { color: fold.muted }]} maxFontSizeMultiplier={1.4}>
                {configuredDow === null
                  ? '指定每周的固定一天进行复盘；仅在当天可填写内容并保存。'
                  : `今天是「${WEEKLY_REVIEW_WEEKDAY_LABELS[new Date().getDay()]}」，已设定为每周「${
                      WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow]
                    }」复盘。请在对应日期再来填写。`}
              </Text>
              <Pressable
                onPress={() => router.push('/review-settings')}
                style={({ pressed }) => [
                  styles.gateBtn,
                  { backgroundColor: fold.pineButton, opacity: pressed ? 0.9 : 1 },
                ]}>
                <Text style={[styles.gateBtnText, { color: fold.onPineButton }]}>去设置复盘日</Text>
              </Pressable>
            </FoldCard>
          ) : (
            <>
              <View style={styles.hero}>
                <View style={styles.heroCopy}>
                  <Text style={[styles.heroTitle, { color: fold.pine }]} maxFontSizeMultiplier={1.3}>
                    这一周，你给自己打几分？
                  </Text>
                  <Text style={[styles.heroSub, { color: fold.muted }]} maxFontSizeMultiplier={1.35}>
                    凭第一直觉选择，不需要完美。
                  </Text>
                </View>
                <View style={[styles.scoreChip, { backgroundColor: fold.sage2 }]}>
                  <Text style={[styles.scoreChipText, { color: fold.pine }]} maxFontSizeMultiplier={1.25}>
                    {executionScore > 0 ? `${executionScore} / 5` : '— / 5'}
                  </Text>
                </View>
              </View>

              <FoldCard style={styles.scoreCard}>
                <View style={styles.cardTopRow}>
                  <Text style={[styles.cardTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                    本周期执行结果
                  </Text>
                  <Text style={[styles.cardHint, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                    1 星 = 偏离 · 5 星 = 达成
                  </Text>
                </View>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map(n => {
                    const on = executionScore >= n;
                    return (
                      <Pressable
                        key={n}
                        disabled={!canEdit}
                        onPress={() => setExecutionScore(prev => (prev === n ? 0 : n))}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={`${n} 星`}
                        accessibilityState={{ selected: executionScore === n }}
                        style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
                        <MaterialIcons
                          name={on ? 'star' : 'star-border'}
                          size={38}
                          color={on ? fold.amber : fold.starEmpty}
                        />
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={[styles.scoreLabel, { color: fold.muted }]} maxFontSizeMultiplier={1.35}>
                  <Text style={{ color: fold.pine, fontWeight: '800' }}>{scoreNote.label}</Text>
                  {'  '}
                  {scoreNote.hint}
                </Text>
              </FoldCard>

              <FoldCard padded={false} style={styles.toggleCard}>
                {[
                  {
                    key: 'tasks',
                    icon: 'checklist' as const,
                    title: '调整任务',
                    desc: '下周减少并行项目，优先三只青蛙',
                    value: adjustTasks,
                    onChange: setAdjustTasks,
                  },
                  {
                    key: 'savings',
                    icon: 'savings' as const,
                    title: '调整储蓄',
                    desc: '把外食预算换到每周 ¥300',
                    value: adjustSavings,
                    onChange: setAdjustSavings,
                  },
                  {
                    key: 'plans',
                    icon: 'event-note' as const,
                    title: '调整计划',
                    desc: '周三晚留空，不安排任何会议',
                    value: adjustPlans,
                    onChange: setAdjustPlans,
                  },
                ].map((item, index) => (
                  <View key={item.key}>
                    {index > 0 ? <View style={[styles.divider, { backgroundColor: fold.line }]} /> : null}
                    <View style={styles.toggleRow}>
                      <View style={[styles.toggleIcon, { backgroundColor: fold.paper2 }]}>
                        <MaterialIcons name={item.icon} size={15} color={fold.ink2} />
                      </View>
                      <View style={styles.toggleCopy}>
                        <Text style={[styles.toggleTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                          {item.title}
                        </Text>
                        <Text style={[styles.toggleDesc, { color: fold.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
                          {item.desc}
                        </Text>
                      </View>
                      <FoldSwitch
                        value={item.value}
                        onValueChange={next => canEdit && item.onChange(next)}
                        disabled={!canEdit}
                        accessibilityLabel={item.title}
                      />
                    </View>
                  </View>
                ))}
              </FoldCard>

              <FoldCard style={styles.metricsCard}>
                <View style={styles.cardTopRow}>
                  <Text style={[styles.cardTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                    周指标参考
                  </Text>
                  <Text style={[styles.cardHint, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                    自动汇总 · 不可编辑
                  </Text>
                </View>
                <View style={styles.metricRow}>
                  <MetricTile
                    value={metrics ? String(Math.round(metrics.tasksCompleted)) : '—'}
                    label="完成任务"
                    fold={fold}
                  />
                  <MetricTile
                    value={metrics ? String(Math.round(metrics.habitCheckInTotal)) : '—'}
                    label="习惯打卡"
                    fold={fold}
                  />
                  <MetricTile
                    value={metrics ? `¥${Math.round(metrics.savingsWeekTotal).toLocaleString('zh-CN')}` : '—'}
                    label="本周存下"
                    fold={fold}
                  />
                  <MetricTile
                    value={metrics ? `¥${Math.round(metrics.financeExpense).toLocaleString('zh-CN')}` : '—'}
                    label="记账支出"
                    fold={fold}
                  />
                </View>
                {metricsOpen ? (
                  <>
                    <View style={styles.metricRow}>
                      <MetricTile
                        value={metrics ? String(Math.round(metrics.tasksCreated)) : '—'}
                        label="新建任务"
                        fold={fold}
                      />
                      <MetricTile
                        value={metrics ? `¥${Math.round(metrics.financeIncome).toLocaleString('zh-CN')}` : '—'}
                        label="记账收入"
                        fold={fold}
                      />
                    </View>
                    <Text style={[styles.metricsNote, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                      统计区间：{metrics?.rangeDisplay || weekRangeLabel || '本周'}。数据来自任务、习惯与财务模块。
                    </Text>
                  </>
                ) : null}

                <View style={[styles.divider, { backgroundColor: fold.line }]} />
                <View style={styles.dailyRefHead}>
                  <Text style={[styles.dailyRefLabel, { color: fold.ink2 }]} maxFontSizeMultiplier={1.25}>
                    日复盘参考 · {dailyFilledCount} / {editableDayTotal} 天
                  </Text>
                  <Pressable onPress={toggleMetricsRefs} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.linkTiny, { color: fold.muted }]}>
                      {metricsOpen ? '收起 ⌃' : '展开 ⌄'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.dayDots}>
                  {dayDots.map(day => (
                    <Pressable
                      key={day.ymd}
                      onPress={() => (day.skipped ? undefined : goDailyReview(day.ymd))}
                      disabled={day.skipped}
                      accessibilityRole="button"
                      accessibilityLabel={`${monthDayLabel(day.ymd)} ${day.label}${day.skipped ? ' 周复盘日' : day.filled ? ' 已复盘' : ' 未复盘'}`}
                      style={({ pressed }) => [
                        styles.dayDot,
                        {
                          backgroundColor: day.today
                            ? fold.pineButton
                            : day.skipped
                              ? fold.paper
                              : day.filled
                                ? fold.sage2
                                : fold.paper2,
                          borderColor: day.today ? fold.pineButton : fold.line,
                          opacity: pressed ? 0.75 : 1,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.dayDotText,
                          { color: day.today ? fold.onPineButton : day.filled ? '#466556' : fold.muted },
                        ]}>
                        {day.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </FoldCard>

              {quoteColumnId ? (
                <View style={[styles.quoteCard, { backgroundColor: fold.aiBg, borderColor: fold.aiBorder }]}>
                  <Text style={[styles.quoteMark, { color: fold.line2 }]}>“</Text>
                  <Text style={[styles.quoteTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
                    留给本周的一句话
                  </Text>
                  <TextInput
                    value={quoteValue}
                    onChangeText={text => setWeeklyField(quoteColumnId, text)}
                    editable={canEdit}
                    multiline
                    scrollEnabled={false}
                    textAlignVertical="top"
                    placeholder="不是每一天都要向前。有些日子，只是把自己接住。"
                    placeholderTextColor={fold.muted}
                    style={[styles.quoteInput, { color: fold.ink2 }]}
                    maxFontSizeMultiplier={1.35}
                  />
                  <Text style={[styles.quoteFoot, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                    已自动保存 · 可稍后回来继续写
                  </Text>
                </View>
              ) : null}

              <FoldCard style={styles.dailyCard}>
                <View style={styles.cardTopRow}>
                  <Text style={[styles.cardTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                    日复盘参考
                  </Text>
                  <Pressable onPress={() => router.push('/daily-review')} hitSlop={8} accessibilityRole="button">
                    <Text style={[styles.cardHint, { color: fold.muted }]}>
                      {dailyFilledCount} / {editableDayTotal} 天 · 点击跳转
                    </Text>
                  </Pressable>
                </View>
                {referenceEntries.length === 0 ? (
                  <Text style={[styles.emptyText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                    本周期还没有已填写的日复盘。
                  </Text>
                ) : (
                  referenceEntries.map((entry, index) => (
                    <View key={entry.ymd}>
                      {index > 0 ? <View style={[styles.divider, { backgroundColor: fold.line }]} /> : null}
                      <Pressable
                        onPress={() => goDailyReview(entry.ymd)}
                        accessibilityRole="button"
                        accessibilityLabel={`打开 ${monthDayLabel(entry.ymd)} 日复盘`}
                        style={({ pressed }) => [styles.refRow, { opacity: pressed ? 0.75 : 1 }]}>
                        <Text style={[styles.refDate, { color: fold.ink2 }]} maxFontSizeMultiplier={1.25}>
                          {monthDayLabel(entry.ymd)}
                        </Text>
                        <Text style={[styles.refPreview, { color: fold.muted }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                          {previewTextFromFields(entry.fields, allDailyColumns) || '已填写'}
                        </Text>
                        <Text style={[styles.refOpen, { color: fold.muted }]}>打开 ›</Text>
                      </Pressable>
                    </View>
                  ))
                )}
                {filledDailyEntries.length > 3 ? (
                  <Pressable onPress={toggleDailyRefs} hitSlop={8} style={styles.refMore} accessibilityRole="button">
                    <Text style={[styles.linkTiny, { color: fold.pine }]}>
                      {dailyReviewsOpen ? '收起日复盘参考' : `展开全部 ${filledDailyEntries.length} 天`}
                    </Text>
                  </Pressable>
                ) : null}
              </FoldCard>

              <FoldCard padded={false} style={styles.fieldsCard}>
                <Pressable
                  onPress={() => setFieldsOpen(v => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: fieldsOpen }}
                  style={({ pressed }) => [styles.fieldsHead, { opacity: pressed ? 0.8 : 1 }]}>
                  <View style={[styles.fieldsIcon, { backgroundColor: fold.paper2 }]}>
                    <MaterialIcons name="edit-note" size={16} color={fold.ink2} />
                  </View>
                  <View style={styles.fieldsCopy}>
                    <Text style={[styles.toggleTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                      本周文字复盘
                    </Text>
                    <Text style={[styles.toggleDesc, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                      {weeklyTemplate.length === 0
                        ? '尚未配置周复盘维度'
                        : `${filledFieldCount} / ${weeklyColumnIds.length} 个栏目有内容`}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => router.push('/review-template-settings?scope=weekly')}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="编辑周复盘模板"
                    style={({ pressed }) => [styles.tuneBtn, { opacity: pressed ? 0.6 : 1 }]}>
                    <MaterialIcons name="tune" size={18} color={fold.muted} />
                  </Pressable>
                  <MaterialIcons name={fieldsOpen ? 'expand-less' : 'expand-more'} size={22} color={fold.muted} />
                </Pressable>

                {fieldsOpen ? (
                  <View style={[styles.fieldsBody, { borderTopColor: fold.line }]}>
                    {weeklyTemplate.length === 0 ? (
                      <Text style={[styles.emptyText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                        请点右上角齿轮管理模板，或前往复盘模板设置为周复盘添加维度。
                      </Text>
                    ) : (
                      detailDimensions.map(dim => (
                        <View key={dim.id} style={styles.fieldDim}>
                          <Text style={[styles.fieldDimTitle, { color: fold.pine }]} maxFontSizeMultiplier={1.3}>
                            {dim.title}
                          </Text>
                          {dim.columns.map(col => (
                            <View key={col.id} style={styles.fieldBlock}>
                              <Text style={[styles.fieldLabel, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                                {col.title}
                              </Text>
                              <TextInput
                                value={weeklyFields[col.id] ?? ''}
                                onChangeText={text => setWeeklyField(col.id, text)}
                                editable={canEdit}
                                multiline
                                textAlignVertical="top"
                                placeholder={col.placeholder || '…'}
                                placeholderTextColor={fold.muted}
                                style={[
                                  styles.fieldInput,
                                  {
                                    backgroundColor: fold.paper2,
                                    borderColor: fold.line,
                                    color: fold.ink,
                                    opacity: canEdit ? 1 : 0.72,
                                  },
                                ]}
                                maxFontSizeMultiplier={1.4}
                              />
                            </View>
                          ))}
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </FoldCard>

              <View style={styles.actionChips}>
                <Pressable
                  onPress={() => void onCopyDailyDigest()}
                  style={({ pressed }) => [
                    styles.actionChip,
                    { borderColor: fold.line2, backgroundColor: fold.cardSoft, opacity: pressed ? 0.8 : 1 },
                  ]}
                  accessibilityRole="button">
                  <MaterialIcons name="content-copy" size={14} color={fold.ink2} />
                  <Text style={[styles.actionChipText, { color: fold.ink2 }]}>复制摘要</Text>
                </Pressable>
                <Pressable
                  onPress={onInsertDailyDigest}
                  style={({ pressed }) => [
                    styles.actionChip,
                    { borderColor: fold.line2, backgroundColor: fold.cardSoft, opacity: pressed ? 0.8 : 1 },
                  ]}
                  accessibilityRole="button">
                  <MaterialIcons name="playlist-add" size={16} color={fold.ink2} />
                  <Text style={[styles.actionChipText, { color: fold.ink2 }]}>插入空栏目</Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => void onGenerateAi()}
                disabled={aiBusy || !canEdit}
                accessibilityRole="button"
                accessibilityState={{ disabled: aiBusy || !canEdit, busy: aiBusy }}
                style={({ pressed }) => [
                  styles.aiButton,
                  {
                    backgroundColor: aiReady ? fold.pineButton : fold.pine2,
                    opacity: aiBusy || !canEdit ? 0.6 : pressed ? 0.9 : 1,
                  },
                ]}>
                {aiBusy ? (
                  <ActivityIndicator color={fold.onPineButton} />
                ) : (
                  <>
                    <MaterialIcons name="auto-awesome" size={17} color={fold.badgeText} />
                    <Text style={[styles.aiButtonText, { color: fold.onPineButton }]} maxFontSizeMultiplier={1.3}>
                      生成 AI 建议 · {aiReady ? '评分与文字已满足' : '还需自评与文字'}
                    </Text>
                  </>
                )}
              </Pressable>

              {aiCoaching ? (
                <View style={[styles.aiResult, { backgroundColor: fold.aiBg, borderColor: fold.aiBorder }]}>
                  <View style={styles.aiResultHead}>
                    <View style={[styles.aiOrb, { backgroundColor: fold.pineButton }]}>
                      <MaterialIcons name="auto-awesome" size={14} color={fold.badgeText} />
                    </View>
                    <Text style={[styles.aiResultTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                      AI 周教练 · 本周建议
                    </Text>
                  </View>
                  <Text style={[styles.aiResultBody, { color: fold.ink2 }]} maxFontSizeMultiplier={1.4}>
                    {aiCoaching}
                  </Text>
                  <View style={styles.aiLinks}>
                    <Pressable onPress={() => router.push('/(tabs)/tasks')} hitSlop={6} accessibilityRole="button">
                      <Text style={[styles.linkTiny, { color: fold.aiInk }]}>去任务 ›</Text>
                    </Pressable>
                    <Pressable onPress={() => router.push('/finance-calendar')} hitSlop={6} accessibilityRole="button">
                      <Text style={[styles.linkTiny, { color: fold.aiInk }]}>财务日历 ›</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.footerStatus}>
                <View style={[styles.footerDot, { backgroundColor: saving ? fold.amber : fold.sage }]} />
                <Text style={[styles.footerText, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
                  {saving
                    ? '正在保存…'
                    : lastSavedAt
                      ? `已保存草稿 · ${lastSavedAt} · 自动保存 900ms`
                      : '尚未保存 · 自动保存 900ms'}
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );

  if (embedded) {
    return <View style={[styles.flex, { backgroundColor: fold.paper }]}>{body}</View>;
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={({ pressed }) => [styles.headerBack, { opacity: pressed ? 0.6 : 1 }]}>
          <MaterialIcons name="arrow-back-ios-new" size={20} color={fold.ink2} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: fold.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
            周复盘 · 经典表单
          </Text>
          <Text style={[styles.headerSub, { color: fold.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
            {weekSubtitle || weekRangeLabel}
          </Text>
        </View>
        <Pressable
          onPress={() => void onSaveDraft()}
          disabled={!canEdit || saving}
          accessibilityRole="button"
          accessibilityLabel="保存草稿"
          style={({ pressed }) => [
            styles.headerPill,
            {
              borderColor: fold.line2,
              backgroundColor: fold.cardSoft,
              opacity: !canEdit || saving ? 0.55 : pressed ? 0.8 : 1,
            },
          ]}>
          {saving ? (
            <ActivityIndicator size="small" color={fold.ink2} />
          ) : (
            <Text style={[styles.headerPillText, { color: fold.ink2 }]}>保存草稿</Text>
          )}
        </Pressable>
      </View>
      {body}
    </SafeAreaView>
  );
}

function MetricTile({
  value,
  label,
  fold,
}: {
  value: string;
  label: string;
  fold: ReturnType<typeof useFoldTheme>['fold'];
}) {
  return (
    <View style={[styles.metricTile, { backgroundColor: fold.paper2 }]}>
      <Text
        style={[styles.metricValue, { color: fold.pine }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        maxFontSizeMultiplier={1.2}>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: fold.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '800', fontFamily: foldFonts.serif },
  headerSub: { fontSize: 10.5, marginTop: 1 },
  headerPill: {
    height: 30,
    minWidth: 68,
    paddingHorizontal: 11,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPillText: { fontSize: 11.5, fontWeight: '700' },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    maxWidth: 460,
    alignSelf: 'center',
    width: '100%',
  },
  scrollEmbedded: { paddingTop: 8 },
  gateCard: { gap: 10, padding: 18, marginTop: 12 },
  gateIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontSize: 17, fontWeight: '800', marginTop: 2 },
  gateBody: { fontSize: 13.5, lineHeight: 21, fontWeight: '500' },
  gateBtn: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  gateBtnText: { fontSize: 13, fontWeight: '800' },
  hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 2, paddingTop: 2 },
  heroCopy: { flex: 1 },
  heroTitle: { fontSize: 23, lineHeight: 31, fontWeight: '600', fontFamily: foldFonts.serif, letterSpacing: 0.2 },
  heroSub: { fontSize: 11.5, marginTop: 4, fontWeight: '500' },
  scoreChip: { borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, marginTop: 3 },
  scoreChipText: { fontSize: 11.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  cardHint: { fontSize: 10.5, fontWeight: '500' },
  scoreCard: { paddingVertical: 14, alignItems: 'center', gap: 4 },
  starsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  scoreLabel: { fontSize: 11.5, lineHeight: 18, textAlign: 'center', marginTop: 4, paddingHorizontal: 4 },
  toggleCard: { paddingVertical: 2 },
  toggleRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  toggleIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  toggleCopy: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: 13, fontWeight: '800' },
  toggleDesc: { fontSize: 10.8, lineHeight: 15 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14 },
  metricsCard: { paddingVertical: 14, gap: 10 },
  metricRow: { flexDirection: 'row', gap: 7 },
  metricTile: { flex: 1, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center', gap: 3 },
  metricValue: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'], fontFamily: foldFonts.mono },
  metricLabel: { fontSize: 9.5, fontWeight: '600', textAlign: 'center' },
  metricsNote: { fontSize: 10, lineHeight: 15 },
  dailyRefHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  dailyRefLabel: { fontSize: 11.5, fontWeight: '700' },
  linkTiny: { fontSize: 10.5, fontWeight: '700' },
  dayDots: { flexDirection: 'row', gap: 5, marginTop: 2 },
  dayDot: {
    flex: 1,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDotText: { fontSize: 11, fontWeight: '800' },
  quoteCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    paddingTop: 12,
  },
  quoteMark: { position: 'absolute', left: 12, top: 6, fontSize: 38, fontFamily: foldFonts.serif },
  quoteTitle: { fontSize: 12.5, fontWeight: '800', marginLeft: 26 },
  quoteInput: {
    marginTop: 6,
    marginLeft: 26,
    minHeight: 44,
    padding: 0,
    fontSize: 14.5,
    lineHeight: 24,
    fontFamily: foldFonts.serif,
  },
  quoteFoot: { fontSize: 10, marginTop: 4, marginLeft: 26 },
  dailyCard: { paddingVertical: 14, gap: 8 },
  refRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 8 },
  refDate: { width: 38, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'], paddingTop: 1 },
  refPreview: { flex: 1, fontSize: 11.5, lineHeight: 17 },
  refOpen: { fontSize: 10.5, fontWeight: '600' },
  refMore: { alignItems: 'center', paddingTop: 2 },
  emptyText: { fontSize: 12, lineHeight: 18, paddingVertical: 6 },
  fieldsCard: { paddingVertical: 0 },
  fieldsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  fieldsIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  fieldsCopy: { flex: 1, gap: 2 },
  tuneBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  fieldsBody: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, gap: 14 },
  fieldDim: { gap: 8 },
  fieldDimTitle: { fontSize: 13, fontWeight: '800', fontFamily: foldFonts.serif },
  fieldBlock: { gap: 5 },
  fieldLabel: { fontSize: 10.5, fontWeight: '700' },
  fieldInput: {
    minHeight: 92,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 22,
  },
  actionChips: { flexDirection: 'row', gap: 8 },
  actionChip: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionChipText: { fontSize: 11.5, fontWeight: '700' },
  aiButton: {
    height: 48,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 2,
    shadowColor: '#23443A',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    elevation: 3,
  },
  aiButtonText: { fontSize: 13, fontWeight: '800' },
  aiResult: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  aiResultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  aiOrb: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  aiResultTitle: { fontSize: 12.5, fontWeight: '800' },
  aiResultBody: { fontSize: 13, lineHeight: 21 },
  aiLinks: { flexDirection: 'row', gap: 16, marginTop: 2 },
  footerStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingTop: 2 },
  footerDot: { width: 5, height: 5, borderRadius: 3 },
  footerText: { fontSize: 10.5 },
});
