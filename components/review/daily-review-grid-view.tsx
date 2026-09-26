import {
  DailyReviewMetaBar,
  DailyReviewSaveStatus,
} from '@/components/review/daily-review-grid-parts';
import { DailyReviewFactsStrip } from '@/components/review/daily-review-facts-strip';
import { DailyReviewInlineComposer } from '@/components/review/daily-review-inline-composer';
import { DailyReviewProgressHintCard } from '@/components/review/daily-review-progress-bar';
import { ReviewAiAnalysisPanel } from '@/components/review/review-ai-analysis-panel';
import { ReviewGridSkeleton } from '@/components/skeletons/review';
import {
  ReviewEmptyState,
  ReviewNoticeBanner,
  ReviewPageContent,
  ReviewPrimaryButton,
} from '@/components/review/review-shared-ui';
import {
  countDailyReviewStreak,
  countEditableDailyEntries,
  countFilledDailyEntries,
  dailyEntryHasContent,
  formatReviewHeaderDate,
  formatWeekReviewProgressLabel,
  isDailyReviewDoneLight,
  isDailyReviewEditableYmd,
  isDailySkipped,
  loadReviewPeriodSnapshot,
  shiftYmd,
  type DailyEntry,
} from '@/components/review/review-utils';
import {
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import {
  formatReviewDayFactsInsertText,
  loadReviewDayFacts,
  type ReviewDayFacts,
} from '@/lib/review-day-facts';
import { Spacing } from '@/constants/design-tokens';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi } from '@/lib/review-ai-analysis';
import { fetchReviewJournal, shouldFetchReviewFromApi } from '@/lib/review-page-api';
import {
  collectColumnIds,
  emptyFieldValues,
  parseDailyReviewBody,
  parseDailyReviewJournal,
  serializeReviewBody,
  type ReviewFieldValues,
  type ReviewJournalMeta,
} from '@/lib/repositories/insights/review-journal-body';
import { listDailyReviewsBetween, upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const AUTO_SAVE_MS = 900;

export function DailyReviewGridView({
  ymd,
  onYmdChange,
  pageApiKey,
  refreshControl,
  onSwitchToWeekly,
}: {
  ymd: string;
  onYmdChange?: (ymd: string) => void;
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onSwitchToWeekly?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [entryLabel, setEntryLabel] = useState('');
  const [dailyTemplate, setDailyTemplate] = useState<
    Awaited<ReturnType<typeof loadReviewPeriodSnapshot>>['dailyTemplate']
  >([]);
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [periodEntries, setPeriodEntries] = useState<DailyEntry[]>([]);
  const [streakEntries, setStreakEntries] = useState<DailyEntry[]>([]);
  const [facts, setFacts] = useState<ReviewDayFacts | null>(null);
  const [dailyReminderEnabled, setDailyReminderEnabled] = useState(false);
  const [dailyReminderTimeLabel, setDailyReminderTimeLabel] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const hydratedRef = useRef(false);
  const skipFirstFocusReloadRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skipped = isDailySkipped(ymd, reviewCycleEndYmd, configuredDow);
  const canEdit = !skipped && isDailyReviewEditableYmd(ymd, todayYmd);
  const todayDone = isDailyReviewDoneLight(fields);

  const weekProgressLabel = useMemo(() => {
    const filled = countFilledDailyEntries(periodEntries, reviewCycleEndYmd, configuredDow);
    const editable = countEditableDailyEntries(periodEntries, reviewCycleEndYmd, configuredDow, todayYmd);
    return formatWeekReviewProgressLabel(filled, editable);
  }, [configuredDow, periodEntries, reviewCycleEndYmd, todayYmd]);

  const streak = useMemo(
    () => countDailyReviewStreak(streakEntries, reviewCycleEndYmd, configuredDow, todayYmd),
    [configuredDow, reviewCycleEndYmd, streakEntries, todayYmd],
  );

  const reload = useCallback(async () => {
    if (!ymd) return;
    hydratedRef.current = false;
    setLoading(true);
    try {
      await wrapLoad(async () => {
        if (shouldFetchReviewFromApi()) {
          await fetchReviewJournal({ scope: 'daily', start: ymd, end: ymd, offlineFallback: true });
        }
        const streakStart = shiftYmd(todayYmd, -45);
        const [snapshot, dailyRows, reminderSettings, dayFacts, streakRows, dailyTpl] = await Promise.all([
          loadReviewPeriodSnapshot(todayYmd),
          listDailyReviewsBetween(ymd, ymd),
          getDailyReviewReminderSettings(),
          ymd <= todayYmd ? loadReviewDayFacts(ymd) : Promise.resolve(null),
          listDailyReviewsBetween(streakStart, todayYmd),
          listReviewTemplate('daily'),
        ]);
        setDailyReminderEnabled(reminderSettings.enabled);
        setDailyReminderTimeLabel(
          reminderSettings.enabled
            ? formatDailyReviewReminderClock(reminderSettings.hour, reminderSettings.minute)
            : null,
        );
        setDailyTemplate(snapshot.dailyTemplate);
        setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);
        setConfiguredDow(snapshot.configuredDow);
        setPeriodEntries(snapshot.dailyEntries);
        setFacts(dayFacts);

        const colIds = collectColumnIds(snapshot.dailyTemplate.length ? snapshot.dailyTemplate : dailyTpl);
        const byYmd = new Map(
          streakRows.map(r => [r.record_date_ymd, parseDailyReviewBody(r.body ?? '', colIds)]),
        );
        const streakList: DailyEntry[] = [];
        for (let i = 0; i <= 45; i++) {
          const d = shiftYmd(streakStart, i);
          streakList.push({
            ymd: d,
            label: d,
            fields: byYmd.get(d) ?? emptyFieldValues(colIds),
          });
        }
        setStreakEntries(streakList);

        const entry = snapshot.dailyEntries.find(e => e.ymd === ymd);
        const journal = parseDailyReviewJournal(dailyRows[0]?.body ?? null, colIds);
        setFields(journal.fields);
        setMeta(journal.meta);
        setEntryLabel(entry?.label ?? formatReviewHeaderDate(ymd));
      });
    } catch {
      setFields({});
      setMeta({});
      setFacts(null);
    } finally {
      setLoading(false);
      hydratedRef.current = true;
    }
  }, [todayYmd, wrapLoad, ymd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocusReloadRef.current) {
        skipFirstFocusReloadRef.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );

  const setMetaPatch = useCallback(
    (patch: Partial<ReviewJournalMeta>) => {
      if (!canEdit) return;
      setMeta(prev => ({ ...prev, ...patch }));
    },
    [canEdit],
  );

  const persist = useCallback(async () => {
    if (!canEdit || !ymd) return;
    setSaving(true);
    try {
      await upsertDailyReviewJournal(ymd, serializeReviewBody(fields, meta));
      if (ymd === todayYmd) {
        void syncDailyReviewReminderNotification();
      }
      setSavedFlash(true);
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
      savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      console.warn('daily review save', e);
    } finally {
      setSaving(false);
    }
  }, [canEdit, fields, meta, todayYmd, ymd]);

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

  const navigateDay = useCallback(
    (delta: number) => {
      const next = shiftYmd(ymd, delta);
      if (onYmdChange) {
        onYmdChange(next);
        return;
      }
      router.replace(`/daily-review/${next}`);
    },
    [onYmdChange, router, ymd],
  );

  const openDimension = useCallback(
    (dimensionId: string) => {
      router.push({ pathname: '/daily-review/[ymd]/[dimensionId]', params: { ymd, dimensionId } });
    },
    [router, ymd],
  );

  const onChangeField = useCallback(
    (columnId: string, plain: string) => {
      if (!canEdit) return;
      setFields(prev => ({ ...prev, [columnId]: plain }));
    },
    [canEdit],
  );

  const onInsertFacts = useCallback(() => {
    if (!canEdit || !facts) return;
    const insert = formatReviewDayFactsInsertText(facts);
    if (!insert) {
      Alert.alert('暂无内容', '今天还没有可写入的事实。');
      return;
    }
    const firstCol = dailyTemplate[0]?.columns[0]?.id ?? Object.keys(fields)[0];
    if (!firstCol) {
      Alert.alert('无法写入', '请先配置日复盘栏目。');
      return;
    }
    const existing = reviewContentToPlainDisplay(fields[firstCol] ?? '').trim();
    const next = existing ? `${existing}\n\n${insert}` : insert;
    setFields(prev => ({ ...prev, [firstCol]: next }));
  }, [canEdit, dailyTemplate, facts, fields]);

  const runAi = useCallback(async () => {
    if (!canEdit) {
      Alert.alert('暂不可用', '当前日期不可生成 AI 分析。');
      return;
    }
    if (!reviewHasEnoughTextForAi(fields)) {
      Alert.alert('内容偏少', '请先填写至少约 30 字，再生成 AI 分析。');
      return;
    }
    setAiBusy(true);
    try {
      const text = await generateReviewAiAnalysis({
        scope: 'daily',
        periodLabel: formatReviewHeaderDate(ymd),
        template: dailyTemplate,
        fields,
      });
      const nextMeta = { ...meta, ai_analysis: text };
      setMeta(nextMeta);
      await upsertDailyReviewJournal(ymd, serializeReviewBody(fields, nextMeta));
      if (ymd === todayYmd) {
        void syncDailyReviewReminderNotification();
      }
      setSavedFlash(true);
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
      savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      console.warn('daily ai analysis', e);
      Alert.alert('分析失败', '请稍后重试。');
    } finally {
      setAiBusy(false);
    }
  }, [canEdit, dailyTemplate, fields, meta, todayYmd, ymd]);

  const headerDateLabel = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return entryLabel;
    return `${Number(m[2])}/${Number(m[3])}`;
  }, [entryLabel, ymd]);

  if (!ymd) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: colors.textMuted }}>无效日期</Text>
      </View>
    );
  }

  if (loading) {
    return <ReviewGridSkeleton />;
  }

  return (
    <ScrollView
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[
        styles.scroll,
        { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
      ]}>
      <ReviewPageContent style={styles.pageGap}>
        <DailyReviewProgressHintCard
          weekLabel={weekProgressLabel}
          streak={streak}
          todayDone={ymd === todayYmd ? todayDone : dailyEntryHasContent(fields)}
        />

        <DailyReviewMetaBar
          meta={meta}
          dateLabel={headerDateLabel}
          canEdit={canEdit}
          canGoNext
          onMetaChange={setMetaPatch}
          onPrevDay={() => navigateDay(-1)}
          onNextDay={() => navigateDay(1)}
          reminderEnabled={dailyReminderEnabled}
          reminderTimeLabel={dailyReminderTimeLabel}
          onOpenReminderSettings={() => router.push('/review-settings')}
        />

        {skipped ? (
          <ReviewNoticeBanner
            icon="event-available"
            message="本日为已设定的每周复盘日，请前往「每周复盘」填写，无需单独做日复盘。"
          />
        ) : !canEdit ? (
          <ReviewNoticeBanner
            icon="lock-outline"
            tone="muted"
            message="未来日期仅可查看，不可编辑与保存。"
          />
        ) : null}

        {!skipped && canEdit ? (
          <DailyReviewFactsStrip facts={facts} canEdit={canEdit} onInsert={onInsertFacts} />
        ) : null}

        {dailyTemplate.length === 0 ? (
          <ReviewEmptyState
            title="尚未配置日复盘维度"
            subtitle="请点右上角「模板」按钮编辑标题与栏目。"
          />
        ) : (
          <DailyReviewInlineComposer
            dimensions={dailyTemplate}
            fields={fields}
            canEdit={canEdit}
            onChangeField={onChangeField}
            onOpenDimension={openDimension}
          />
        )}

        <DailyReviewSaveStatus saving={saving} saved={savedFlash} />

        {!skipped ? (
          <ReviewAiAnalysisPanel
            text={meta.ai_analysis}
            busy={aiBusy}
            canRun={canEdit}
            onAnalyze={() => void runAi()}
            disabledReason={!canEdit ? '当前日期不可生成分析' : undefined}
          />
        ) : null}

        {skipped ? (
          <ReviewPrimaryButton
            label="去填写每周复盘"
            onPress={() => (onSwitchToWeekly ? onSwitchToWeekly() : router.push('/weekly-review-form'))}
          />
        ) : null}
      </ReviewPageContent>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    width: '100%',
    paddingTop: Spacing.sm,
  },
  pageGap: {
    gap: Spacing.xl,
    paddingHorizontal: 0,
  },
});
