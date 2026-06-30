import {
  DailyReviewGrid,
  DailyReviewMetaBar,
  DailyReviewSaveStatus,
} from '@/components/review/daily-review-grid-parts';
import {
  formatReviewHeaderDate,
  isDailyReviewEditableYmd,
  isDailySkipped,
  loadReviewPeriodSnapshot,
  shiftYmd,
} from '@/components/review/review-utils';
import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  collectColumnIds,
  parseDailyReviewJournal,
  serializeReviewBody,
  type ReviewFieldValues,
  type ReviewJournalMeta,
} from '@/lib/repositories/insights/review-journal-body';
import { listDailyReviewsBetween, upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
}: {
  ymd: string;
  onYmdChange?: (ymd: string) => void;
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [entryLabel, setEntryLabel] = useState('');
  const [dailyTemplate, setDailyTemplate] = useState<Awaited<ReturnType<typeof loadReviewPeriodSnapshot>>['dailyTemplate']>([]);
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);

  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const skipped = isDailySkipped(ymd, reviewCycleEndYmd, configuredDow);
  const canEdit = !skipped && isDailyReviewEditableYmd(ymd, todayYmd);

  const reload = useCallback(async () => {
    if (!ymd) return;
    hydratedRef.current = false;
    setLoading(true);
    try {
      await wrapLoad(async () => {
        const [snapshot, dailyRows] = await Promise.all([
          loadReviewPeriodSnapshot(todayYmd),
          listDailyReviewsBetween(ymd, ymd),
        ]);
        setDailyTemplate(snapshot.dailyTemplate);
        setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);
        setConfiguredDow(snapshot.configuredDow);
        const entry = snapshot.dailyEntries.find(e => e.ymd === ymd);
        const colIds = collectColumnIds(snapshot.dailyTemplate);
        const journal = parseDailyReviewJournal(dailyRows[0]?.body ?? null, colIds);
        setFields(journal.fields);
        setMeta(journal.meta);
        setEntryLabel(entry?.label ?? formatReviewHeaderDate(ymd));
      });
    } catch {
      setFields({});
      setMeta({});
    } finally {
      setLoading(false);
      hydratedRef.current = true;
    }
  }, [todayYmd, wrapLoad, ymd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setField = useCallback(
    (columnId: string, value: string) => {
      if (!canEdit) return;
      setFields(prev => ({ ...prev, [columnId]: value }));
    },
    [canEdit],
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
      setSavedFlash(true);
      if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
      savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (e) {
      console.warn('daily review save', e);
    } finally {
      setSaving(false);
    }
  }, [canEdit, fields, meta, ymd]);

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

  const headerDateLabel = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return entryLabel;
    return `${Number(m[2])}/${Number(m[3])}`;
  }, [entryLabel, ymd]);

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

  if (!ymd) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: colors.textMuted }}>无效日期</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Spacing['6xl'] + Math.max(insets.bottom, Spacing.xl) },
          ]}>
          <DailyReviewMetaBar
            meta={meta}
            dateLabel={headerDateLabel}
            canEdit={canEdit}
            canGoNext
            colors={gridColors}
            onMetaChange={setMetaPatch}
            onPrevDay={() => navigateDay(-1)}
            onNextDay={() => navigateDay(1)}
          />

          {skipped ? (
              <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
                <MaterialIcons name="event-available" size={22} color={colors.primary} />
                <Text style={[Typography.body, { color: colors.text, flex: 1, lineHeight: 21 }]}>
                  本日为已设定的每周复盘日，请前往「每周复盘」填写，无需单独做日复盘。
                </Text>
              </View>
            ) : !canEdit ? (
              <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
                <MaterialIcons name="lock-outline" size={22} color={colors.textMuted} />
                <Text style={[Typography.body, { color: colors.textMuted, flex: 1, lineHeight: 21 }]}>
                  未来日期仅可查看，不可编辑与保存。
                </Text>
              </View>
            ) : null}

            {dailyTemplate.length === 0 ? (
              <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21, paddingHorizontal: Layout.pagePaddingX }]}>
                尚未配置日复盘维度，请先在「复盘设置」中管理模板。
              </Text>
            ) : (
              <DailyReviewGrid
                dimensions={dailyTemplate}
                fields={fields}
                canEdit={canEdit}
                colors={gridColors}
                onSetField={setField}
                onPressDimension={openDimension}
              />
            )}

            <DailyReviewSaveStatus saving={saving} saved={savedFlash} colors={gridColors} />

            {skipped ? (
              <Pressable
                onPress={() => router.push('/weekly-review-form')}
                style={({ pressed }) => [
                  styles.actionBtn,
                  { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
                ]}>
                <Text style={styles.actionBtnText}>去填写每周复盘</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: {
    gap: Spacing.xl,
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
