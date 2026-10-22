import {
  FoldAiMini,
  FoldBoundaryBanner,
  FoldDateTitle,
  FoldDayAppBar,
  FoldDayMetaStrip,
  FoldDimensionGrid,
  FoldProgressCard,
  FoldTodayDataCard,
  foldDayMotto,
} from '@/components/review/fold-daily-overview-parts';
import { FoldCard, FoldSectionHeader } from '@/components/review/fold-ui';
import { ReviewAiAnalysisScreen } from '@/components/review/review-ai-analysis-screen';
import { ReviewGridSkeleton } from '@/components/skeletons/review';
import {
  countDailyReviewStreak,
  countEditableDailyEntries,
  countFilledDailyEntries,
  dayOfYear,
  formatClockFromDatetime,
  formatReviewHeaderDate,
  isDailyReviewEditableYmd,
  isDailySkipped,
  isoWeekNumber,
  loadReviewPeriodSnapshot,
  shiftYmd,
  type DailyEntry,
} from '@/components/review/review-utils';
import { Typography } from '@/constants/design-tokens';
import { useFoldTheme } from '@/constants/review-fold-theme';
import {
  formatDailyReviewReminderClock,
  getDailyReviewReminderSettings,
} from '@/lib/daily-review-reminder-settings';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { loadReviewDayFacts, builtinDailyReviewFieldPatch, reviewDayFactsIsEmpty, type ReviewDayFacts } from '@/lib/review-day-facts';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
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
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  listDailyReviewsBetween,
  upsertDailyReviewJournal,
} from '@/lib/repositories/insights/daily-review-journal';
import { ensureBuiltinDailyReviewModules, listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
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
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

function clockNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function parseYmdParts(ymd: string): { year: number; month: number; day: number; dow: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return { year, month, day, dow: new Date(year, month - 1, day).getDay() };
}

function countFilledDimensions(template: ReviewDimensionTemplate[], fields: ReviewFieldValues): number {
  return template.filter(dim => dim.columns.some(col => (fields[col.id] ?? '').trim().length > 0)).length;
}

export function DailyReviewGridView({
  ymd,
  onYmdChange,
  pageApiKey,
  refreshControl,
  onRegisterReload,
  onSwitchToWeekly,
}: {
  ymd: string;
  onYmdChange?: (ymd: string) => void;
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onRegisterReload?: (reload: () => Promise<void>) => void;
  onSwitchToWeekly?: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette } = useFoldTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [entryLabel, setEntryLabel] = useState('');
  const [dailyTemplate, setDailyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [periodEntries, setPeriodEntries] = useState<DailyEntry[]>([]);
  const [streakEntries, setStreakEntries] = useState<DailyEntry[]>([]);
  const [facts, setFacts] = useState<ReviewDayFacts | null>(null);
  const [dailyReminderEnabled, setDailyReminderEnabled] = useState(false);
  const [dailyReminderTimeLabel, setDailyReminderTimeLabel] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const hydratedRef = useRef(false);
  /** 首屏成功后永为 true；快切日期时不能用 hydratedRef 判断 silent（它会被置回 false） */
  const readyOnceRef = useRef(false);
  const loadGenRef = useRef(0);
  const skipFirstFocusReloadRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  const skipped = isDailySkipped(ymd, reviewCycleEndYmd, configuredDow);
  const canEdit = !skipped && isDailyReviewEditableYmd(ymd, todayYmd);

  const weekFilled = useMemo(
    () => countFilledDailyEntries(periodEntries, reviewCycleEndYmd, configuredDow),
    [configuredDow, periodEntries, reviewCycleEndYmd],
  );
  const weekTotal = useMemo(
    () =>
      Math.max(
        weekFilled,
        countEditableDailyEntries(periodEntries, reviewCycleEndYmd, configuredDow, todayYmd),
      ),
    [configuredDow, periodEntries, reviewCycleEndYmd, todayYmd, weekFilled],
  );

  const streak = useMemo(
    () => countDailyReviewStreak(streakEntries, reviewCycleEndYmd, configuredDow, todayYmd),
    [configuredDow, reviewCycleEndYmd, streakEntries, todayYmd],
  );

  const filledDims = useMemo(() => countFilledDimensions(dailyTemplate, fields), [dailyTemplate, fields]);

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!ymd) return;
      // 已首屏成功过则永远静默，避免快切时 hydratedRef 被置 false 又闪骨架
      const silent = opts?.silent === true || readyOnceRef.current;
      const gen = ++loadGenRef.current;
      hydratedRef.current = false;
      if (!silent) setLoading(true);
      try {
        await wrapLoad(async () => {
          await ensureBuiltinDailyReviewModules();
          if (shouldFetchReviewFromApi()) {
            await fetchReviewJournal({ scope: 'daily', start: ymd, end: ymd });
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
          if (gen !== loadGenRef.current) return;
          setDailyReminderEnabled(reminderSettings.enabled);
          setDailyReminderTimeLabel(
            reminderSettings.enabled
              ? formatDailyReviewReminderClock(reminderSettings.hour, reminderSettings.minute)
              : null,
          );
          setDailyTemplate(snapshot.dailyTemplate.length ? snapshot.dailyTemplate : dailyTpl);
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
            streakList.push({ ymd: d, label: d, fields: byYmd.get(d) ?? emptyFieldValues(colIds) });
          }
          setStreakEntries(streakList);

          const entry = snapshot.dailyEntries.find(e => e.ymd === ymd);
          const journal = parseDailyReviewJournal(dailyRows[0]?.body ?? null, colIds);
          setFields(journal.fields);
          setMeta(journal.meta);
          setEntryLabel(entry?.label ?? formatReviewHeaderDate(ymd));
          setSavedAt(formatClockFromDatetime(dailyRows[0]?.updated_at ?? null));
        });
      } catch {
        if (gen !== loadGenRef.current) return;
        setFields({});
        setMeta({});
        setFacts(null);
      } finally {
        if (gen !== loadGenRef.current) return;
        setLoading(false);
        hydratedRef.current = true;
        readyOnceRef.current = true;
      }
    },
    [todayYmd, wrapLoad, ymd],
  );

  useEffect(() => {
    void reload({ silent: readyOnceRef.current });
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

  const setMetaPatch = useCallback(
    (patch: Partial<ReviewJournalMeta>) => {
      if (!canEdit) return;
      dirtyRef.current = true;
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
      setSavedAt(clockNow());
    } catch (e) {
      console.warn('daily review save', e);
      toast.error(toUserMessage(e, '复盘保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [canEdit, fields, meta, todayYmd, ymd]);

  useEffect(() => {
    if (!hydratedRef.current || !canEdit || !dirtyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      dirtyRef.current = false;
      void persist();
    }, AUTO_SAVE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [canEdit, fields, meta, persist]);

  const navigateDay = useCallback(
    (delta: number) => {
      const next = shiftYmd(ymd, delta);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (dirtyRef.current && canEdit) {
        dirtyRef.current = false;
        void persist();
      }
      if (onYmdChange) {
        onYmdChange(next);
        return;
      }
      // 无 onYmdChange 时用 setParams，避免 replace 的切屏动画
      router.setParams({ ymd: next });
    },
    [canEdit, onYmdChange, persist, router, ymd],
  );

  const openDimension = useCallback(
    (dimensionId: string) => {
      router.push({ pathname: '/daily-review/[ymd]/[dimensionId]', params: { ymd, dimensionId } });
    },
    [router, ymd],
  );

  const templateColumnIds = useMemo(() => new Set(collectColumnIds(dailyTemplate)), [dailyTemplate]);

  /** 一键写入：把当日健康 / 任务 / 财务汇总写进对应内置栏目（只写有数据的栏） */
  const insertFacts = useCallback(() => {
    if (!canEdit || !facts) return;
    const patch = builtinDailyReviewFieldPatch(facts);
    const entries = Object.entries(patch).filter(([columnId]) => templateColumnIds.has(columnId));
    if (entries.length === 0) {
      toast.info('今天还没有可写入的健康、任务或财务数据');
      return;
    }
    setFields(prev => {
      const next = { ...prev };
      for (const [columnId, value] of entries) next[columnId] = value;
      return next;
    });
    dirtyRef.current = true;
    toast.success(`已写入 ${entries.length} 栏今日数据`);
  }, [canEdit, facts, templateColumnIds]);

  const persistAiText = useCallback(
    async (text: string) => {
      if (!ymd) return;
      const nextMeta = { ...meta, ai_analysis: text };
      setMeta(nextMeta);
      await upsertDailyReviewJournal(ymd, serializeReviewBody(fields, nextMeta));
      if (ymd === todayYmd) {
        void syncDailyReviewReminderNotification();
      }
      setSavedAt(clockNow());
    },
    [fields, meta, todayYmd, ymd],
  );

  const parts = useMemo(() => parseYmdParts(ymd), [ymd]);
  const dateLabel = parts ? `${parts.month}月${parts.day}日` : entryLabel;
  const weekdayLabel = parts ? `周${WEEKDAY_LABELS[parts.dow]}` : '';
  const subLabel = parts
    ? `${parts.year} · 第 ${isoWeekNumber(ymd)} 周 · ${foldDayMotto(ymd)}`
    : foldDayMotto(ymd);

  const appbarSub = `DAY ${dayOfYear(ymd)} · ${
    saving ? '保存中…' : savedAt ? `已自动保存 ${savedAt}` : '自动保存开启'
  }`;

  const weekNo = useMemo(() => isoWeekNumber(ymd), [ymd]);
  const weekStartYmd = periodEntries[0]?.ymd || ymd;

  const todayTaskDimensionId = useMemo(() => {
    const hit = dailyTemplate.find(dim => dim.title.includes('任务'));
    return hit?.id ?? dailyTemplate[0]?.id ?? null;
  }, [dailyTemplate]);

  const openMore = useCallback(() => {
    Alert.alert('更多', undefined, [
      { text: '一键写入今日数据', onPress: insertFacts },
      { text: '去填写每周复盘', onPress: () => (onSwitchToWeekly ? onSwitchToWeekly() : router.push('/weekly-review-form')) },
      { text: 'AI 复盘分析', onPress: () => setAiOpen(true) },
      { text: '取消', style: 'cancel' },
    ]);
  }, [insertFacts, onSwitchToWeekly, router]);

  const goWeekly = useCallback(() => {
    if (onSwitchToWeekly) onSwitchToWeekly();
    else router.push('/weekly-review-form');
  }, [onSwitchToWeekly, router]);

  if (!ymd) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: palette.muted }}>无效日期</Text>
      </View>
    );
  }

  // 仅真正首屏显示骨架；切日保留当前页，静默换数
  if (loading && !readyOnceRef.current) {
    return <ReviewGridSkeleton />;
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.paper }]}>
      <FoldDayAppBar
        title="日复盘"
        subtitle={appbarSub}
        onBack={() => router.back()}
        onMore={openMore}
        topInset={insets.top}
      />

      <ScrollView
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 56 }]}>
        <FoldDateTitle
          dateLabel={dateLabel}
          weekdayLabel={weekdayLabel}
          subLabel={subLabel}
          saveLabel={saving ? '保存中' : savedAt ? '已自动保存' : '本地优先'}
        />

        {skipped ? (
          <FoldBoundaryBanner
            variant="weekly"
            title="本日为每周复盘日"
            body="先把这一周合上，再翻开新的一页。"
            actionLabel="去填写"
            onPress={goWeekly}
          />
        ) : !canEdit ? (
          <FoldBoundaryBanner
            variant="locked"
            title="未来日期只读"
            body="提前写下的复盘不算数，等到那一天再回来。"
          />
        ) : null}

        <FoldProgressCard
          filledDims={filledDims}
          totalDims={Math.max(dailyTemplate.length, 1)}
          weekFilled={weekFilled}
          weekTotal={Math.max(weekTotal, 1)}
          streak={streak}
        />

        <FoldDayMetaStrip
          meta={meta}
          canEdit={canEdit}
          onMetaChange={setMetaPatch}
          reminderEnabled={dailyReminderEnabled}
          reminderTimeLabel={dailyReminderTimeLabel}
          onOpenReminderSettings={() => router.push('/review-settings')}
          onPrevDay={() => navigateDay(-1)}
          onNextDay={() => navigateDay(1)}
          canGoNext={ymd < todayYmd}
        />

        {!skipped && facts ? (
          <FoldTodayDataCard
            facts={facts}
            onViewAll={todayTaskDimensionId ? () => openDimension(todayTaskDimensionId) : undefined}
            onInsertFacts={canEdit && !reviewDayFactsIsEmpty(facts) ? insertFacts : undefined}
          />
        ) : null}

        {!skipped ? (
          <>
            <View style={styles.dimSectionHead}>
              <FoldSectionHeader
                title="维度预览"
                hint={`点击进入编辑 · ${filledDims}/${dailyTemplate.length} 已填`}
              />
            </View>
            {dailyTemplate.length === 0 ? (
              <FoldCard tone="muted" style={styles.emptyCard}>
                <Text style={[Typography.bodyStrong, { color: palette.ink }]} maxFontSizeMultiplier={1.35}>
                  尚未配置日复盘维度
                </Text>
                <Text
                  style={[Typography.body, { color: palette.muted, lineHeight: 20 }]}
                  maxFontSizeMultiplier={1.35}>
                  去「模板」里添加健康、任务、财务之后的栏目。
                </Text>
              </FoldCard>
            ) : (
              <FoldDimensionGrid
                dimensions={dailyTemplate}
                fields={fields}
                canEdit={canEdit}
                onOpenDimension={openDimension}
              />
            )}

            <FoldAiMini text={meta.ai_analysis} onOpen={() => setAiOpen(true)} />
          </>
        ) : null}

        {savedAt ? (
          <View style={styles.autoSave}>
            <View style={[styles.autoSaveDot, { backgroundColor: palette.sage }]} />
            <Text style={[styles.autoSaveText, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
              已自动保存 · {savedAt}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <ReviewAiAnalysisScreen
        visible={aiOpen}
        onClose={() => setAiOpen(false)}
        scope="daily"
        scopeLabel="日复盘"
        weekNo={weekNo}
        periodLabel={formatReviewHeaderDate(ymd)}
        weekStartYmd={weekStartYmd}
        template={dailyTemplate}
        fields={fields}
        dailyEntries={periodEntries}
        initialText={meta.ai_analysis ?? null}
        canEdit={canEdit}
        onPersist={persistAiText}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 2,
  },
  dimSectionHead: {
    marginTop: 16,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  emptyCard: {
    marginTop: 8,
    gap: 6,
  },
  autoSave: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 14,
  },
  autoSaveDot: { width: 5, height: 5, borderRadius: 3 },
  autoSaveText: { fontSize: 10 },
});
