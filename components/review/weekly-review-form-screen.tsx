import {
  CheckRow,
  Field,
  LinkChip,
  SectionTitle,
  WeeklyMetricsReferenceCard,
} from '@/components/review/review-ui-parts';
import { loadReviewPeriodSnapshot, WEEKLY_REVIEW_WEEKDAY_LABELS } from '@/components/review/review-utils';
import { ScreenHeader } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'weekly-review-form';

export function WeeklyReviewFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.4)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const inputSurface = isDark ? 'rgba(15,23,42,0.55)' : '#f4f6ff';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
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

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      if (shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) {
        setLoading(false);
        return;
      }
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    return () => resetPageApiSession(PAGE_API_KEY);
  }, []);

  const persistDraft = useCallback(async () => {
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
    } catch (e) {
      console.warn('weekly review save', e);
      Alert.alert('保存失败', '请稍后再试');
    } finally {
      setSaving(false);
    }
  }, [periodStartYmd, weeklyFields, executionScore, adjustTasks, adjustSavings, adjustPlans]);

  const onSaveDraft = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可保存', '仅在已设定的「每周复盘日」当天可填写与保存；请先设置复盘日，并在对应日期打开本页。');
      return;
    }
    await persistDraft();
    Alert.alert('已保存', '复盘草稿已写入本地。');
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
      await persistDraft();
      const coaching = await generateWeeklyReviewCoaching({
        weekRangeLabel,
        template: weeklyTemplate,
        fields: weeklyFields,
        executionScore,
        metrics,
        dailyReviewsDigest: buildDailyDigest(
          dailyEntries.filter(e => !isDailyReviewSkippedOnWeeklyReviewDay(e.ymd, reviewCycleEndYmd, configuredDow)),
          dailyTemplate,
        ),
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
    dailyTemplate,
    weekRangeLabel,
    metrics,
    periodStartYmd,
    persistDraft,
    canEdit,
    dailyEntries,
    reviewCycleEndYmd,
    configuredDow,
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

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScreenHeader title="每周复盘" subtitle={weekRangeLabel || undefined} onBack={() => router.back()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={primary} />
          </View>
        ) : (
          <ScrollView
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.scroll, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}>
            {!canEdit ? (
              <View style={[styles.gateCard, { backgroundColor: isDark ? 'rgba(30,41,59,0.65)' : '#fff7ed', borderColor: outlineVariant }]}>
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
                    { borderColor: outlineVariant, opacity: pressed ? 0.88 : 1 },
                  ]}>
                  <Text style={[styles.gateBtnText, { color: primary }]}>去设置复盘日</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text style={[styles.intro, { color: outline }]}>
                  由你亲自书写。保存后可一键生成 AI 建议；智谱可配 EXPO_PUBLIC_ZHIPU_API_KEY（未设置环境变量时使用应用内置密钥兜底）。
                </Text>

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

                <Pressable
                  onPress={() => router.push('/review-template-settings?scope=weekly')}
                  style={({ pressed }) => [
                    styles.templateLinkBtn,
                    { borderColor: outlineVariant, opacity: pressed ? 0.88 : 1 },
                  ]}>
                  <MaterialIcons name="tune" size={18} color={primary} />
                  <Text style={[styles.templateLinkText, { color: primary }]}>管理周复盘维度与栏目</Text>
                </Pressable>

                {weeklyTemplate.length === 0 ? (
                  <Text style={[styles.intro, { color: outline }]}>尚未配置周复盘维度，请先管理模板。</Text>
                ) : (
                  weeklyTemplate.map((dim, dimIdx) => {
                    const nLabels = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
                    return (
                      <View key={dim.id}>
                        <SectionTitle color={text} n={nLabels[dimIdx] ?? String(dimIdx + 1)} title={dim.title} />
                        {dim.columns.map(col => (
                          <View key={col.id} style={dim.columns.length > 1 ? { marginBottom: 8 } : undefined}>
                            {dim.columns.length > 1 ? (
                              <Text style={[styles.fieldLabel, { color: outline, marginBottom: 6 }]}>{col.title}</Text>
                            ) : null}
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
                    {aiBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>生成 AI 建议</Text>}
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
                      <Text style={styles.btnWideText}>保存调整意向</Text>
                    </Pressable>

                    <View style={styles.linkRow}>
                      <LinkChip label="去任务" onPress={() => router.push('/(tabs)/tasks')} color={primary} />
                      <LinkChip label="存钱计划" onPress={() => router.push('/savings-plan')} color={tertiary} />
                      <LinkChip label="财务日历" onPress={() => router.push('/finance-calendar')} color={primary} />
                    </View>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing.xl,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
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
  intro: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  templateLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  templateLinkText: { fontSize: 13, fontWeight: '800' },
  fieldLabel: { fontSize: 12, fontWeight: '800' },
  scoreTitle: { fontSize: 16, fontWeight: '900', marginTop: 14 },
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
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  aiCard: {
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 1,
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
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnWideText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 8,
    marginLeft: 8,
  },
});
