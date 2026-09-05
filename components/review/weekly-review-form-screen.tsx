import {
  CheckRow,
  Field,
  LinkChip,
  SectionTitle,
  WeeklyDailyReviewsReferenceCard,
  WeeklyMetricsReferenceCard,
  WeeklyReviewQuickRefBar,
} from '@/components/review/review-ui-parts';
import {
  countEditableDailyEntries,
  countFilledDailyEntries,
  dailyEntryHasContent,
  getYesterdayYmd,
  loadReviewPeriodSnapshot,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/components/review/review-utils';
import { ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { generateWeeklyReviewCoaching, weeklyReviewHasEnoughText } from '@/lib/weekly-review-coaching';
import {
  buildDailyDigest,
  collectColumnIds,
  emptyFieldValues,
  parseWeeklyReviewFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { fetchWeeklyReviewMetrics, getRollingSevenDayRangeEndingOnNextReviewDay } from '@/lib/repositories/insights/weekly-review';
import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewJournalByWeek,
  setWeeklyReviewCoachingText,
  updateWeeklyReviewAdjustFlags,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import { isDailyReviewSkippedOnWeeklyReviewDay } from '@/lib/weekly-review-settings';
import { resetPageApiSession, shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'weekly-review-form';

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
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(apiKey);

  const bg = colors.background;
  const surface = colors.surface;
  const text = colors.text;
  const outline = colors.textMuted;
  const outlineVariant = colors.outline;
  const primary = colors.primary;
  const secondary = colors.secondary;
  const tertiary = colors.tertiary;
  const inputSurface = colors.input;
  const onPrimary = colors.onPrimary;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [dailyReviewsOpen, setDailyReviewsOpen] = useState(false);
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

  const scrollRef = useRef<ScrollView>(null);
  const refsSectionY = useRef(0);

  const scrollToRefs = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, refsSectionY.current - 12), animated: true });
    });
  }, []);

  const toggleDailyRefs = useCallback(() => {
    setDailyReviewsOpen(v => {
      const next = !v;
      if (next) scrollToRefs();
      return next;
    });
  }, [scrollToRefs]);

  const toggleMetricsRefs = useCallback(() => {
    setMetricsOpen(v => {
      const next = !v;
      if (next) scrollToRefs();
      return next;
    });
  }, [scrollToRefs]);

  const onRefsSectionLayout = useCallback((e: LayoutChangeEvent) => {
    refsSectionY.current = e.nativeEvent.layout.y;
  }, []);

  const reload = useCallback(
    async (forceApi = false) => {
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

          if (!snapshot.canEditWeekly) {
            setPeriodStartYmd('');
            setMetrics(null);
            setWeeklyFields(emptyFieldValues(wColIds));
            setExecutionScore(0);
            setAiCoaching(null);
            setAdjustTasks(false);
            setAdjustSavings(false);
            setAdjustPlans(false);
            return;
          }

          setPeriodStartYmd(snapshot.periodStartYmd);
          const today = new Date();
          const rolling =
            snapshot.configuredDow !== null
              ? getRollingSevenDayRangeEndingOnNextReviewDay(today, snapshot.configuredDow)
              : null;
          const metricsAnchor = rolling
            ? new Date(rolling.end.getFullYear(), rolling.end.getMonth(), rolling.end.getDate())
            : today;

          const [row, m] = await Promise.all([
            getWeeklyReviewJournalByWeek(snapshot.periodStartYmd),
            fetchWeeklyReviewMetrics(metricsAnchor, 'rolling-7'),
          ]);
          setMetrics(m);
          if (row) {
            setWeeklyFields(parseWeeklyReviewFields(row, wColIds));
            setExecutionScore(row.execution_score > 0 ? row.execution_score : 0);
            setAiCoaching(row.ai_coaching);
            setAdjustTasks(row.adjust_tasks === 1);
            setAdjustSavings(row.adjust_savings === 1);
            setAdjustPlans(row.adjust_plans === 1);
          } else {
            setWeeklyFields(emptyFieldValues(wColIds));
            setExecutionScore(0);
            setAiCoaching(null);
            setAdjustTasks(false);
            setAdjustSavings(false);
            setAdjustPlans(false);
          }
        }, forceApi);
      } catch {
        setMetrics(null);
      } finally {
        setLoading(false);
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
      return true;
    } catch (e) {
      console.warn('weekly review save', e);
      Alert.alert('保存失败', '请稍后再试');
      return false;
    } finally {
      setSaving(false);
    }
  }, [periodStartYmd, weeklyFields, executionScore, adjustTasks, adjustSavings, adjustPlans]);

  const onSaveDraft = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可保存', '仅在已设定的「每周复盘日」当天可填写与保存；请先设置复盘日，并在对应日期打开本页。');
      return;
    }
    const ok = await persistDraft();
    if (ok) Alert.alert('已保存', '复盘草稿已写入本地。');
  }, [canEdit, periodStartYmd, persistDraft]);

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
      Alert.alert('生成失败', '请检查网络；未配置当前所选引擎的 API 密钥时将使用本地规则生成。');
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

  const onSaveAdjustIntent = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可保存', '仅在复盘日当天可保存调整意向。');
      return;
    }
    try {
      await updateWeeklyReviewAdjustFlags(periodStartYmd, {
        adjust_tasks: adjustTasks,
        adjust_savings: adjustSavings,
        adjust_plans: adjustPlans,
      });
      Alert.alert('已记录', '已保存你的调整意向，可随时回来修改。');
    } catch {
      Alert.alert('保存失败', '请稍后再试');
    }
  }, [canEdit, periodStartYmd, adjustTasks, adjustSavings, adjustPlans]);

  const setWeeklyField = useCallback((columnId: string, value: string) => {
    setWeeklyFields(prev => ({ ...prev, [columnId]: value }));
  }, []);

  const yesterdayYmd = useMemo(() => getYesterdayYmd(todayYmd), [todayYmd]);

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

  const body = (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={[
            styles.scroll,
            embedded && styles.scrollEmbedded,
            { paddingBottom: 28 + Math.max(insets.bottom, 12) },
          ]}>
            {!canEdit ? (
              <View style={[styles.gateCard, { backgroundColor: colors.surfaceMuted, borderColor: outlineVariant }]}>
                <MaterialIcons name="lock-clock" size={22} color={tertiary} />
                <Text style={[styles.gateTitle, { color: text }]}>
                  {configuredDow === null ? '请先设置每周复盘日' : '今天不是复盘日'}
                </Text>
                <Text style={[styles.gateBody, { color: outline }]}>
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
                    { borderColor: outlineVariant, backgroundColor: colors.primaryMuted, opacity: pressed ? 0.88 : 1 },
                  ]}>
                  <Text style={[styles.gateBtnText, { color: primary }]}>去设置复盘日</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <WeeklyReviewQuickRefBar
                  filledCount={dailyFilledCount}
                  editableCount={dailyEditableCount}
                  hasDigest={dailyDigest.trim().length > 0}
                  dailyOpen={dailyReviewsOpen}
                  metricsOpen={metricsOpen}
                  isDark={isDark}
                  outline={outline}
                  outlineVariant={outlineVariant}
                  primary={primary}
                  secondary={secondary}
                  onToggleDaily={toggleDailyRefs}
                  onToggleMetrics={toggleMetricsRefs}
                  onCopyDigest={() => void onCopyDailyDigest()}
                  onInsertDigest={onInsertDailyDigest}
                  onTemplateSettings={() => router.push('/review-template-settings?scope=weekly')}
                />

                {weeklyTemplate.length === 0 ? (
                  <Text style={[styles.emptyHint, { color: outline }]}>尚未配置周复盘维度，请点右上角齿轮管理模板。</Text>
                ) : (
                  weeklyTemplate.map((dim, dimIdx) => {
                    const nLabels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
                    return (
                      <View key={dim.id}>
                        <SectionTitle color={text} n={nLabels[dimIdx] ?? String(dimIdx + 1)} title={dim.title} />
                        {dim.columns.map(col => (
                          <View key={col.id} style={{ marginBottom: 8 }}>
                            <Text style={[styles.fieldLabel, { color: outline, marginBottom: 6 }]}>{col.title}</Text>
                            <Field
                              value={weeklyFields[col.id] ?? ''}
                              onChangeText={t => setWeeklyField(col.id, t)}
                              editable={canEdit}
                              placeholder={col.placeholder || '…'}
                              inputSurface={inputSurface}
                              inputBorder={outlineVariant}
                              textColor={text}
                              hintColor={outline}
                            />
                          </View>
                        ))}
                      </View>
                    );
                  })
                )}

                <Text style={[styles.scoreTitle, { color: text }]}>本周期执行结果自评</Text>
                <Text style={[styles.scoreHint, { color: outline }]}>1 星偏低，5 星代表整体执行满意</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <Pressable key={n} disabled={!canEdit} onPress={() => setExecutionScore(n)} hitSlop={6}>
                      <MaterialIcons
                        name={executionScore >= n ? 'star' : 'star-border'}
                        size={36}
                        color={!canEdit ? outlineVariant : executionScore >= n ? tertiary : outline}
                      />
                    </Pressable>
                  ))}
                </View>

                <View style={styles.btnRow}>
                  <Pressable
                    onPress={() => void onSaveDraft()}
                    disabled={saving || !canEdit}
                    style={({ pressed }) => [
                      styles.btnSecondary,
                      { borderColor: outlineVariant, opacity: pressed || saving || !canEdit ? 0.55 : 1 },
                    ]}>
                    {saving ? (
                      <ActivityIndicator color={primary} />
                    ) : (
                      <Text style={[styles.btnSecondaryText, { color: primary }]}>保存草稿</Text>
                    )}
                  </Pressable>
                  <Pressable
                    onPress={() => void onGenerateAi()}
                    disabled={aiBusy || !canEdit}
                    style={({ pressed }) => [
                      styles.btnPrimary,
                      { backgroundColor: primary, opacity: pressed || aiBusy || !canEdit ? 0.55 : 1 },
                    ]}>
                    {aiBusy ? <ActivityIndicator color={onPrimary} /> : <Text style={[styles.btnPrimaryText, { color: onPrimary }]}>生成 AI 建议</Text>}
                  </Pressable>
                </View>

                {aiCoaching ? (
                  <View style={[styles.aiCard, { backgroundColor: surface, borderColor: outlineVariant }]}>
                    <View style={[styles.aiBar, { backgroundColor: primary }]} />
                    <Text style={[styles.aiHead, { color: text }]}>AI 汇总与建议</Text>
                    <Text style={[styles.aiBody, { color: text }]}>{aiCoaching}</Text>

                    <Text style={[styles.adjustTitle, { color: text }]}>是否愿意据此做调整？（自选）</Text>
                    <CheckRow
                      checked={adjustTasks}
                      onToggle={() => canEdit && setAdjustTasks(v => !v)}
                      label="调整任务安排 / 优先级"
                      textColor={text}
                      outline={outline}
                      primary={primary}
                      disabled={!canEdit}
                    />
                    <CheckRow
                      checked={adjustSavings}
                      onToggle={() => canEdit && setAdjustSavings(v => !v)}
                      label="检查或修正存钱计划节奏"
                      textColor={text}
                      outline={outline}
                      primary={primary}
                      disabled={!canEdit}
                    />
                    <CheckRow
                      checked={adjustPlans}
                      onToggle={() => canEdit && setAdjustPlans(v => !v)}
                      label="重新安排时间、兼顾生活与工作"
                      textColor={text}
                      outline={outline}
                      primary={primary}
                      disabled={!canEdit}
                    />

                    <Pressable
                      onPress={() => void onSaveAdjustIntent()}
                      disabled={!canEdit}
                      style={({ pressed }) => [
                        styles.btnWide,
                        { backgroundColor: secondary, opacity: pressed || !canEdit ? 0.55 : 1 },
                      ]}>
                      <Text style={[styles.btnWideText, { color: onPrimary }]}>保存调整意向</Text>
                    </Pressable>

                    <View style={styles.linkRow}>
                      <LinkChip label="去任务" onPress={() => router.push('/(tabs)/tasks')} color={primary} />
                      <LinkChip label="心愿单" onPress={() => router.push('/wish-list')} color={tertiary} />
                      <LinkChip label="财务日历" onPress={() => router.push('/finance-calendar')} color={primary} />
                    </View>
                  </View>
                ) : null}

                <View style={styles.refsSection} onLayout={onRefsSectionLayout}>
                  <Text style={[styles.refsSectionTitle, { color: outline }]}>参考资料（可选）</Text>
                  <WeeklyDailyReviewsReferenceCard
                    open={dailyReviewsOpen}
                    onToggle={() => setDailyReviewsOpen(v => !v)}
                    entries={dailyEntries}
                    dailyTemplate={dailyTemplate}
                    todayYmd={todayYmd}
                    yesterdayYmd={yesterdayYmd}
                    filledCount={dailyFilledCount}
                    editableCount={dailyEditableCount}
                    isSkipped={isDailySkipped}
                    digestPreview={dailyDigest}
                    hasDigest={dailyDigest.trim().length > 0}
                    isDark={isDark}
                    surface={surface}
                    text={text}
                    outline={outline}
                    outlineVariant={outlineVariant}
                    primary={primary}
                    secondary={secondary}
                    onDayPress={goDailyReview}
                    onListPress={() => router.push('/daily-review')}
                    onCopyDigest={() => void onCopyDailyDigest()}
                    onInsertDigest={onInsertDailyDigest}
                    showEntryCards={false}
                  />
                  <WeeklyMetricsReferenceCard
                    open={metricsOpen}
                    onToggle={() => setMetricsOpen(v => !v)}
                    metrics={metrics}
                    isDark={isDark}
                    surface={surface}
                    text={text}
                    outline={outline}
                    outlineVariant={outlineVariant}
                    primary={primary}
                    secondary={secondary}
                    tertiary={tertiary}
                  />
                </View>
              </>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
  );

  if (embedded) {
    return <View style={[styles.flex, { backgroundColor: bg }]}>{body}</View>;
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScreenHeader title="每周复盘" subtitle={weekRangeLabel || undefined} onBack={() => router.back()} />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  scrollEmbedded: {
    paddingTop: Spacing.md,
  },
  gateCard: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    padding: Spacing['3xl'],
    gap: Spacing.md,
  },
  gateTitle: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  gateBody: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  gateBtn: {
    alignSelf: 'flex-start',
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing['3xl'],
    marginTop: Spacing.sm,
  },
  gateBtnText: { fontSize: 14, fontWeight: '800' },
  emptyHint: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  refsSection: { gap: Spacing.md, marginTop: Spacing.sm },
  refsSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fieldLabel: { fontSize: 12, fontWeight: '800' },
  scoreTitle: { fontSize: 16, fontWeight: '900', marginTop: 4 },
  scoreHint: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  starsRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btnSecondary: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSecondaryText: { fontSize: 15, fontWeight: '800' },
  btnPrimary: {
    flex: 1,
    borderRadius: Radius.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { fontSize: 15, fontWeight: '900' },
  aiCard: {
    marginTop: 8,
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    overflow: 'hidden',
    gap: 10,
  },
  aiBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  aiHead: { fontSize: 17, fontWeight: '900', marginLeft: 8 },
  aiBody: { fontSize: 15, lineHeight: 24, fontWeight: '600', marginLeft: 8 },
  adjustTitle: { fontSize: 15, fontWeight: '900', marginTop: 8, marginLeft: 8 },
  btnWide: {
    marginTop: 8,
    borderRadius: Radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnWideText: { fontSize: 15, fontWeight: '900' },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 8,
    marginLeft: 8,
  },
});
