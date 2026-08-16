import {
  DailyReviewGrid,
} from '@/components/review/daily-review-grid-parts';
import { ReviewAiAnalysisPanel } from '@/components/review/review-ai-analysis-panel';
import {
  formatReviewMonthLabel,
  isMonthlyReviewEditable,
  monthStartYmdFromYmd,
  shiftMonthStartYmd,
} from '@/components/review/review-utils';
import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi } from '@/lib/review-ai-analysis';
import {
  collectColumnIds,
  parseDailyReviewJournal,
  serializeReviewBody,
  type ReviewFieldValues,
  type ReviewJournalMeta,
} from '@/lib/repositories/insights/review-journal-body';
import {
  getMonthlyReviewJournalByMonth,
  upsertMonthlyReviewJournal,
} from '@/lib/repositories/insights/monthly-review-journal';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
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

const AUTO_SAVE_MS = 900;

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
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const { wrapLoad } = usePageApiSync(pageApiKey);

  const [monthStartYmd, setMonthStartYmd] = useState(() => monthStartYmdFromYmd(todayYmd));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fields, setFields] = useState<ReviewFieldValues>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [monthlyTemplate, setMonthlyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [aiBusy, setAiBusy] = useState(false);

  const hydratedRef = useRef(false);
  const skipFirstFocusReloadRef = useRef(true);
  const lastPersistedBodyRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canEdit = isMonthlyReviewEditable(monthStartYmd, todayYmd);
  const canGoNext = monthStartYmd < monthStartYmdFromYmd(todayYmd);
  const monthLabel = formatReviewMonthLabel(monthStartYmd);

  useEffect(() => {
    onMonthLabelChange?.(monthLabel);
  }, [monthLabel, onMonthLabelChange]);

  const reload = useCallback(async () => {
    hydratedRef.current = false;
    setLoading(true);
    try {
      await wrapLoad(async () => {
        const [tpl, row] = await Promise.all([
          listReviewTemplate('monthly'),
          getMonthlyReviewJournalByMonth(monthStartYmd),
        ]);
        setMonthlyTemplate(tpl);
        const colIds = collectColumnIds(tpl);
        const journal = parseDailyReviewJournal(row?.body ?? null, colIds);
        setFields(journal.fields);
        setMeta(journal.meta);
        lastPersistedBodyRef.current = serializeReviewBody(journal.fields, journal.meta);
      });
    } catch {
      setFields({});
      setMeta({});
      setMonthlyTemplate([]);
      lastPersistedBodyRef.current = null;
    } finally {
      setLoading(false);
      hydratedRef.current = true;
    }
  }, [monthStartYmd, wrapLoad]);

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

  const persist = useCallback(async () => {
    if (!canEdit) return;
    const body = serializeReviewBody(fields, meta);
    if (body === lastPersistedBodyRef.current) return;
    setSaving(true);
    try {
      await upsertMonthlyReviewJournal(monthStartYmd, body);
      lastPersistedBodyRef.current = body;
    } catch (e) {
      console.warn('monthly review save', e);
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
      // 新路由尚未写入 expo-router 生成类型时，先按路径跳转
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
      const body = serializeReviewBody(fields, nextMeta);
      await upsertMonthlyReviewJournal(monthStartYmd, body);
      lastPersistedBodyRef.current = body;
    } catch (e) {
      console.warn('monthly ai analysis', e);
      Alert.alert('分析失败', '请稍后重试。');
    } finally {
      setAiBusy(false);
    }
  }, [canEdit, fields, meta, monthLabel, monthStartYmd, monthlyTemplate, persist]);

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
          <View style={styles.metaBar}>
            <View style={styles.monthNav}>
              <Pressable
                onPress={() => setMonthStartYmd(prev => shiftMonthStartYmd(prev, -1))}
                hitSlop={Layout.hitSlop}
                style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.7 : 1 }]}>
                <MaterialIcons name="chevron-left" size={28} color={colors.textMuted} />
              </Pressable>
              <Text style={[styles.monthLabel, { color: colors.textMuted }]} numberOfLines={1}>
                {monthLabel}
              </Text>
              <Pressable
                onPress={() => setMonthStartYmd(prev => shiftMonthStartYmd(prev, 1))}
                disabled={!canGoNext}
                hitSlop={Layout.hitSlop}
                style={({ pressed }) => [
                  styles.iconBtn,
                  { opacity: !canGoNext ? 0.3 : pressed ? 0.7 : 1 },
                ]}>
                <MaterialIcons name="chevron-right" size={28} color={colors.textMuted} />
              </Pressable>
            </View>
            {saving ? (
              <Text style={[Typography.caption, { color: colors.textMuted, textAlign: 'center' }]}>
                保存中…
              </Text>
            ) : null}
          </View>

          {!canEdit ? (
            <View style={[styles.notice, { backgroundColor: colors.surfaceMuted, borderColor: colors.outline }]}>
              <MaterialIcons name="lock-clock" size={22} color={colors.textMuted} />
              <Text style={[Typography.body, { color: colors.textMuted, flex: 1, lineHeight: 21 }]}>
                未来月份仅可查看，暂不可填写。
              </Text>
            </View>
          ) : null}

          {monthlyTemplate.length === 0 ? (
            <Text
              style={[
                Typography.body,
                { color: colors.textMuted, lineHeight: 21, paddingHorizontal: Spacing.md },
              ]}>
              尚未配置月复盘维度，请点右上角「模板」按钮编辑标题与栏目。
            </Text>
          ) : (
            <DailyReviewGrid
              dimensions={monthlyTemplate}
              fields={fields}
              colors={gridColors}
              onPressDimension={openDimension}
            />
          )}

          <ReviewAiAnalysisPanel
            text={meta.ai_analysis}
            busy={aiBusy}
            canRun={canEdit}
            onAnalyze={() => void runAi()}
            disabledReason={!canEdit ? '未来月份不可生成分析' : undefined}
          />
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
    width: '100%',
  },
  metaBar: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: '700',
    minWidth: 120,
    textAlign: 'center',
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.lg,
    borderRadius: 12,
    borderWidth: 1,
    padding: Spacing['3xl'],
    marginHorizontal: Spacing.md,
  },
});
