import {
  DailyReviewGrid,
  WeeklyReviewMetaBar,
} from '@/components/review/daily-review-grid-parts';
import {
  loadReviewPeriodSnapshot,
  WEEKLY_REVIEW_WEEKDAY_LABELS,
} from '@/components/review/review-utils';
import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
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
import { getWeeklyReviewJournalByWeek } from '@/lib/repositories/insights/weekly-review-journal';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
      });
    } catch {
      setFields({});
      setWeeklyTemplate([]);
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
