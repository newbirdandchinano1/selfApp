import {
  DailyReviewGrid,
  WeeklyReviewMetaBar,
} from '@/components/review/daily-review-grid-parts';
import { ReviewAiAnalysisPanel } from '@/components/review/review-ai-analysis-panel';
import {
  loadReviewPeriodSnapshot,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/components/review/review-utils';
import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi } from '@/lib/review-ai-analysis';
import {
  collectColumnIds,
  emptyFieldValues,
  parseWeeklyReviewFields,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  getRollingSevenDayRange,
  getRollingSevenDayRangeEndingOnNextReviewDay,
} from '@/lib/repositories/insights/weekly-review';
import {
  getWeeklyReviewJournalByWeek,
  setWeeklyReviewCoachingText,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
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
  type RefreshControlProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function WeeklyReviewGridView({
  pageApiKey,
  refreshControl,
  onRegisterReload,
}: {
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onRegisterReload?: (reload: () => Promise<void>) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [weeklyTemplate, setWeeklyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [periodStartYmd, setPeriodStartYmd] = useState('');
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [aiCoaching, setAiCoaching] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const journalMetaRef = useRef({
    execution_score: 0,
    adjust_tasks: false,
    adjust_savings: false,
    adjust_plans: false,
  });

  const skipFirstFocusReloadRef = useRef(true);

  const reload = useCallback(async () => {
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

        const today = new Date();
        const rolling =
          snapshot.configuredDow !== null
            ? getRollingSevenDayRangeEndingOnNextReviewDay(today, snapshot.configuredDow)
            : getRollingSevenDayRange(today);
        const startYmd = rolling.startYmd;
        setPeriodStartYmd(startYmd);
        setWeeklyTemplate(weeklyTpl);

        const wColIds = collectColumnIds(weeklyTpl);
        const row = await getWeeklyReviewJournalByWeek(startYmd);
        setFields(row ? parseWeeklyReviewFields(row, wColIds) : emptyFieldValues(wColIds));
        setAiCoaching(row?.ai_coaching ?? null);
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
    } finally {
      setLoading(false);
    }
  }, [todayYmd, wrapLoad]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!onRegisterReload) return;
    onRegisterReload(reload);
    return () => onRegisterReload(async () => {});
  }, [onRegisterReload, reload]);

  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocusReloadRef.current) {
        skipFirstFocusReloadRef.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );

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

  const runAi = useCallback(async () => {
    if (!canEdit || !periodStartYmd) {
      Alert.alert('暂不可用', '仅在已设定的周复盘日可生成 AI 分析。');
      return;
    }
    if (!reviewHasEnoughTextForAi(fields)) {
      Alert.alert('内容偏少', '请先填写至少约 30 字，再生成 AI 分析。');
      return;
    }
    setAiBusy(true);
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
      const text = await generateReviewAiAnalysis({
        scope: 'weekly',
        periodLabel: weekRangeLabel || periodStartYmd,
        template: weeklyTemplate,
        fields,
      });
      await setWeeklyReviewCoachingText(periodStartYmd, text);
      setAiCoaching(text);
    } catch (e) {
      console.warn('weekly ai analysis', e);
      Alert.alert('分析失败', '请稍后重试。');
    } finally {
      setAiBusy(false);
    }
  }, [canEdit, fields, periodStartYmd, weekRangeLabel, weeklyTemplate]);

  const configuredDowLabel = useMemo(
    () => (configuredDow !== null ? WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow] : undefined),
    [configuredDow],
  );

  const gridColors = useMemo(
    () => ({
      text: colors.text,
      textMuted: colors.textMuted,
      outline: colors.outline,
      primary: colors.primary,
      input: isDark ? 'rgba(15,23,42,0.55)' : colors.input,
      background: colors.background,
    }),
    [colors, isDark],
  );

  return (
    <>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
          ]}>
          <WeeklyReviewMetaBar
            weekRangeLabel={weekRangeLabel}
            configuredDowLabel={configuredDowLabel}
            colors={gridColors}
            onOpenReviewDaySettings={() => router.push('/review-settings')}
          />

          {configuredDow === null ? (
            <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
              <MaterialIcons name="event-available" size={22} color={colors.primary} />
              <Text style={[Typography.body, { color: colors.text, flex: 1, lineHeight: 21 }]}>
                尚未设置每周复盘日。设置后可在对应日期填写与保存周复盘。
              </Text>
            </View>
          ) : !canEdit ? (
            <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
              <MaterialIcons name="lock-clock" size={22} color={colors.textMuted} />
              <Text style={[Typography.body, { color: colors.textMuted, flex: 1, lineHeight: 21 }]}>
                今天不是复盘日，仅可查看本周期内容；请在每周「{configuredDowLabel}」填写与保存。
              </Text>
            </View>
          ) : null}

          {weeklyTemplate.length === 0 ? (
            <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21, paddingHorizontal: Layout.pagePaddingX }]}>
              尚未配置周复盘维度，请点右上角「模板」按钮编辑标题与栏目。
            </Text>
          ) : (
            <DailyReviewGrid
              dimensions={weeklyTemplate}
              fields={fields}
              colors={gridColors}
              onPressDimension={openDimension}
            />
          )}

          <ReviewAiAnalysisPanel
            text={aiCoaching}
            busy={aiBusy}
            canRun={canEdit}
            onAnalyze={() => void runAi()}
            disabledReason={
              configuredDow === null
                ? '请先设置每周复盘日'
                : !canEdit
                  ? '今天不是复盘日，暂不可生成分析'
                  : undefined
            }
          />

          {configuredDow === null ? (
            <Pressable
              onPress={() => router.push('/review-settings')}
              style={({ pressed }) => [
                styles.actionBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}>
              <Text style={styles.actionBtnText}>设置周复盘日</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    gap: Spacing.xl,
    paddingTop: Spacing.sm,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing['3xl'],
    marginHorizontal: Layout.pagePaddingX,
  },
  actionBtn: {
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Layout.pagePaddingX,
  },
  actionBtnText: { color: '#fff', fontSize: 15, fontWeight: '900' },
});
