import {
  DailyReviewGrid,
  WeeklyReviewMetaBar,
} from '@/components/review/daily-review-grid-parts';
import { ReviewAiAnalysisPanel } from '@/components/review/review-ai-analysis-panel';
import { ReviewGridSkeleton } from '@/components/review/review-home-skeletons';
import {
  ReviewEmptyState,
  ReviewNoticeBanner,
  ReviewPageContent,
  ReviewPrimaryButton,
} from '@/components/review/review-shared-ui';
import {
  loadReviewPeriodSnapshot,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/components/review/review-utils';
import { Spacing } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
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
import { useFocusEffect } from "expo-router/react-navigation";
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
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

  if (loading) {
    return <ReviewGridSkeleton />;
  }

  return (
    <ScrollView
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
      ]}>
      <ReviewPageContent style={styles.pageGap}>
        <WeeklyReviewMetaBar
          weekRangeLabel={weekRangeLabel}
          configuredDowLabel={configuredDowLabel}
          onOpenReviewDaySettings={() => router.push('/review-settings')}
        />

        {configuredDow === null ? (
          <ReviewNoticeBanner
            icon="event-available"
            message="尚未设置每周复盘日。设置后可在对应日期填写与保存周复盘。"
          />
        ) : !canEdit ? (
          <ReviewNoticeBanner
            icon="lock-clock"
            tone="muted"
            message={`今天不是复盘日，仅可查看本周期内容；请在每周「${configuredDowLabel}」填写与保存。`}
          />
        ) : null}

        {weeklyTemplate.length === 0 ? (
          <ReviewEmptyState
            title="尚未配置周复盘维度"
            subtitle="请点右上角「模板」按钮编辑标题与栏目。"
          />
        ) : (
          <DailyReviewGrid
            dimensions={weeklyTemplate}
            fields={fields}
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
          <ReviewPrimaryButton label="设置周复盘日" onPress={() => router.push('/review-settings')} />
        ) : null}
      </ReviewPageContent>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    width: '100%',
    paddingTop: Spacing.sm,
  },
  pageGap: {
    gap: Spacing.xl,
  },
});
