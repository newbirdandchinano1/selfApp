/**
 * 日 / 周 / 月维度详情屏同构实现：编辑器、自动保存、工具栏共用；
 * scope 只决定路由参数、模板、可否编辑、persist 适配与是否展示 AI panel。
 */
import { ReviewAiAnalysisPanel } from '@/components/review/review-ai-analysis-panel';
import { ReviewFieldEditor, type ReviewFieldEditorState } from '@/components/review/review-field-editor';
import { ReviewDimensionSkeleton } from '@/components/skeletons/review';
import {
  formatReviewHeaderDate,
  formatReviewMonthLabel,
  isMonthlyReviewEditable,
  loadReviewPeriodSnapshot,
} from '@/components/review/review-utils';
import { ScreenHeader } from '@/components/ui';
import { Layout, Radius, Shadows, Spacing, Typography } from '@/constants/design-tokens';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi } from '@/lib/review-ai-analysis';
import {
  applyFontSizeToTextModel,
  currentFontSizeLabel,
  emptyReviewFieldModel,
  getNowTimeText,
  insertImageBlock,
  insertTextIntoTextModel,
  parseReviewFieldContent,
  serializeReviewFieldContent,
  toggleTodoAtSelection,
  type ReviewFieldModel,
  type TextSelection,
} from '@/lib/review-journal-format';
import { listDailyReviewsBetween, upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
import {
  getMonthlyReviewJournalByMonth,
  upsertMonthlyReviewJournal,
} from '@/lib/repositories/insights/monthly-review-journal';
import {
  collectColumnIds,
  emptyFieldValues,
  parseDailyReviewJournal,
  parseWeeklyReviewFields,
  serializeReviewBody,
  type ReviewFieldValues,
  type ReviewJournalMeta,
} from '@/lib/repositories/insights/review-journal-body';
import type { ReviewJournalScope } from '@/lib/repositories/insights/review-journal-store';
import { listReviewTemplate } from '@/lib/repositories/insights/review-template';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import {
  getWeeklyReviewJournalByWeek,
  upsertWeeklyReviewJournal,
} from '@/lib/repositories/insights/weekly-review-journal';
import {
  fetchReviewCatalog,
  fetchReviewJournal,
  shouldFetchReviewFromApi,
} from '@/lib/review-page-api';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const AUTO_SAVE_MS = 900;
const MAX_HISTORY = 50;

const SCOPE_PAGE_KEY: Record<ReviewJournalScope, string> = {
  daily: 'daily-review-dimension-detail',
  weekly: 'weekly-review-dimension-detail',
  monthly: 'monthly-review-dimension-detail',
};

const SCOPE_FALLBACK_TITLE: Record<ReviewJournalScope, string> = {
  daily: '复盘详情',
  weekly: '周复盘详情',
  monthly: '月复盘详情',
};

const DEFAULT_EDITOR_STATE: ReviewFieldEditorState = {
  blockIndex: 0,
  selection: { start: 0, end: 0 },
};

type WeeklyJournalMeta = {
  execution_score: number;
  adjust_tasks: boolean;
  adjust_savings: boolean;
  adjust_plans: boolean;
  ai_coaching: string | null;
};

function emptyEditorStateByColumn(columnIds: string[]): Record<string, ReviewFieldEditorState> {
  const out: Record<string, ReviewFieldEditorState> = {};
  for (const id of columnIds) out[id] = { ...DEFAULT_EDITOR_STATE };
  return out;
}

function fieldValuesToModels(fields: ReviewFieldValues): Record<string, ReviewFieldModel> {
  const out: Record<string, ReviewFieldModel> = {};
  for (const [id, value] of Object.entries(fields)) {
    out[id] = parseReviewFieldContent(value ?? '');
  }
  return out;
}

function fieldModelsToValues(models: Record<string, ReviewFieldModel>): ReviewFieldValues {
  const out: ReviewFieldValues = {};
  for (const [id, model] of Object.entries(models)) {
    out[id] = serializeReviewFieldContent(model);
  }
  return out;
}

function serializeWeeklyPersistPayload(fields: ReviewFieldValues, meta: WeeklyJournalMeta): string {
  return JSON.stringify({ fields, meta });
}

function firstParam(raw: string | string[] | undefined): string {
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? '';
}

export function ReviewDimensionDetailScreen({ scope }: { scope: ReviewJournalScope }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const params = useLocalSearchParams<{
    ymd?: string | string[];
    weekStartYmd?: string | string[];
    monthStartYmd?: string | string[];
    dimensionId?: string | string[];
  }>();

  const periodYmd =
    scope === 'daily'
      ? firstParam(params.ymd)
      : scope === 'weekly'
        ? firstParam(params.weekStartYmd)
        : firstParam(params.monthStartYmd);
  const dimensionId = firstParam(params.dimensionId);
  const { wrapLoad } = usePageApiSync(SCOPE_PAGE_KEY[scope]);
  const fallbackTitle = SCOPE_FALLBACK_TITLE[scope];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [fieldModels, setFieldModels] = useState<Record<string, ReviewFieldModel>>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [template, setTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [dimensionTitle, setDimensionTitle] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [activeColumnId, setActiveColumnId] = useState('');
  const [editorStateByColumn, setEditorStateByColumn] = useState<Record<string, ReviewFieldEditorState>>({});
  const [controlledSelectionByColumn, setControlledSelectionByColumn] = useState<
    Record<string, TextSelection | undefined>
  >({});
  const [aiBusy, setAiBusy] = useState(false);

  const hydratedRef = useRef(false);
  const lastPersistedPayloadRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStacksRef = useRef<Record<string, string[]>>({});
  const redoStacksRef = useRef<Record<string, string[]>>({});
  const weeklyMetaRef = useRef<WeeklyJournalMeta>({
    execution_score: 0,
    adjust_tasks: false,
    adjust_savings: false,
    adjust_plans: false,
    ai_coaching: null,
  });

  const dimension = useMemo(() => template.find(d => d.id === dimensionId) ?? null, [template, dimensionId]);
  const activeColumn = useMemo(
    () => dimension?.columns.find(c => c.id === activeColumnId) ?? dimension?.columns[0] ?? null,
    [activeColumnId, dimension],
  );
  const activeEditorState = activeColumnId
    ? (editorStateByColumn[activeColumnId] ?? DEFAULT_EDITOR_STATE)
    : DEFAULT_EDITOR_STATE;
  const activeFieldModel = activeColumnId
    ? (fieldModels[activeColumnId] ?? emptyReviewFieldModel())
    : emptyReviewFieldModel();
  const activeTextBlock = activeFieldModel.blocks[activeEditorState.blockIndex];
  const activeTextModel = activeTextBlock?.kind === 'text' ? activeTextBlock.model : null;

  const fontSizeLabel = useMemo(() => {
    if (!activeTextModel) return 15;
    return currentFontSizeLabel(activeTextModel, activeEditorState.selection);
  }, [activeEditorState.selection, activeTextModel]);

  const fields = useMemo(() => fieldModelsToValues(fieldModels), [fieldModels]);

  const commitFieldModel = useCallback(
    (columnId: string, model: ReviewFieldModel, opts?: { editorState?: ReviewFieldEditorState }) => {
      const nextValue = serializeReviewFieldContent(model);
      let previousValue = '';
      setFieldModels(prev => {
        previousValue = serializeReviewFieldContent(prev[columnId] ?? emptyReviewFieldModel());
        if (previousValue === nextValue) return prev;
        return { ...prev, [columnId]: model };
      });

      if (previousValue !== nextValue) {
        const undoStack = undoStacksRef.current[columnId] ?? [];
        undoStacksRef.current[columnId] = [...undoStack, previousValue].slice(-MAX_HISTORY);
        redoStacksRef.current[columnId] = [];
      }

      setActiveColumnId(columnId);
      if (opts?.editorState) {
        setEditorStateByColumn(prev => ({ ...prev, [columnId]: opts.editorState! }));
        setControlledSelectionByColumn(prev => ({ ...prev, [columnId]: opts.editorState!.selection }));
      }
    },
    [],
  );

  const applyLoadedState = useCallback(
    (opts: {
      tpl: ReviewDimensionTemplate[];
      models: Record<string, ReviewFieldModel>;
      payload: string;
      title: string;
      label: string;
      editable: boolean;
      journalMeta?: ReviewJournalMeta;
      weeklyMeta?: WeeklyJournalMeta;
    }) => {
      setTemplate(opts.tpl);
      setFieldModels(opts.models);
      setMeta(opts.journalMeta ?? {});
      if (opts.weeklyMeta) weeklyMetaRef.current = opts.weeklyMeta;
      lastPersistedPayloadRef.current = opts.payload;
      setCanEdit(opts.editable);
      setPeriodLabel(opts.label);
      setDimensionTitle(opts.title);

      const dim = opts.tpl.find(d => d.id === dimensionId);
      const dimColIds = dim?.columns.map(c => c.id) ?? [];
      setActiveColumnId(dim?.columns[0]?.id ?? '');
      setEditorStateByColumn(emptyEditorStateByColumn(dimColIds));
      setControlledSelectionByColumn({});
      undoStacksRef.current = {};
      redoStacksRef.current = {};
    },
    [dimensionId],
  );

  const reload = useCallback(async () => {
    if (!periodYmd || !dimensionId) return;
    hydratedRef.current = false;
    setLoading(true);
    try {
      await wrapLoad(async () => {
        if (shouldFetchReviewFromApi()) {
          if (scope === 'daily') {
            await fetchReviewJournal({ scope: 'daily', start: periodYmd, end: periodYmd, offlineFallback: true });
          } else {
            await Promise.all([
              fetchReviewCatalog({ scope, offlineFallback: true }),
              fetchReviewJournal({
                scope,
                weekStart: scope === 'weekly' ? periodYmd : undefined,
                monthStart: scope === 'monthly' ? periodYmd : undefined,
                offlineFallback: true,
              }),
            ]);
          }
        }

        if (scope === 'daily') {
          const [snapshot, dailyRows] = await Promise.all([
            loadReviewPeriodSnapshot(todayYmd),
            listDailyReviewsBetween(periodYmd, periodYmd),
          ]);
          const colIds = collectColumnIds(snapshot.dailyTemplate);
          const journal = parseDailyReviewJournal(dailyRows[0]?.body ?? null, colIds);
          const models = fieldValuesToModels(journal.fields);
          const entry = snapshot.dailyEntries.find(e => e.ymd === periodYmd);
          applyLoadedState({
            tpl: snapshot.dailyTemplate,
            models,
            payload: serializeReviewBody(fieldModelsToValues(models), journal.meta),
            title: snapshot.dailyTemplate.find(d => d.id === dimensionId)?.title ?? entry?.label ?? fallbackTitle,
            label: formatReviewHeaderDate(periodYmd),
            editable: periodYmd <= todayYmd,
            journalMeta: journal.meta,
          });
          return;
        }

        if (scope === 'weekly') {
          const [snapshot, weeklyTpl, row] = await Promise.all([
            loadReviewPeriodSnapshot(todayYmd),
            listReviewTemplate('weekly'),
            getWeeklyReviewJournalByWeek(periodYmd),
          ]);
          const colIds = collectColumnIds(weeklyTpl);
          const parsed = parseWeeklyReviewFields(row, colIds);
          const models = fieldValuesToModels(parsed);
          const weeklyMeta: WeeklyJournalMeta = {
            execution_score: row?.execution_score ?? 0,
            adjust_tasks: row?.adjust_tasks === 1,
            adjust_savings: row?.adjust_savings === 1,
            adjust_plans: row?.adjust_plans === 1,
            ai_coaching: row?.ai_coaching ?? null,
          };
          applyLoadedState({
            tpl: weeklyTpl,
            models,
            payload: serializeWeeklyPersistPayload(fieldModelsToValues(models), weeklyMeta),
            title: weeklyTpl.find(d => d.id === dimensionId)?.title ?? fallbackTitle,
            label: snapshot.weekRangeLabel,
            editable: snapshot.canEditWeekly,
            weeklyMeta,
          });
          return;
        }

        const [tpl, row] = await Promise.all([
          listReviewTemplate('monthly'),
          getMonthlyReviewJournalByMonth(periodYmd),
        ]);
        const colIds = collectColumnIds(tpl);
        const journal = parseDailyReviewJournal(row?.body ?? null, colIds);
        const models = fieldValuesToModels(journal.fields);
        applyLoadedState({
          tpl,
          models,
          payload: serializeReviewBody(fieldModelsToValues(models), journal.meta),
          title: tpl.find(d => d.id === dimensionId)?.title ?? fallbackTitle,
          label: formatReviewMonthLabel(periodYmd),
          editable: isMonthlyReviewEditable(periodYmd, todayYmd),
          journalMeta: journal.meta,
        });
      });
    } catch {
      setFieldModels(fieldValuesToModels(emptyFieldValues([])));
      setMeta({});
      lastPersistedPayloadRef.current = null;
      setDimensionTitle(fallbackTitle);
      setActiveColumnId('');
      setEditorStateByColumn({});
      setControlledSelectionByColumn({});
      undoStacksRef.current = {};
      redoStacksRef.current = {};
    } finally {
      setLoading(false);
      hydratedRef.current = true;
    }
  }, [applyLoadedState, dimensionId, fallbackTitle, periodYmd, scope, todayYmd, wrapLoad]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const flashSaved = useCallback(() => {
    setSavedFlash(true);
    if (savedFlashTimerRef.current) clearTimeout(savedFlashTimerRef.current);
    savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2000);
  }, []);

  const persist = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!canEdit || !periodYmd) return;

      if (scope === 'weekly') {
        const weeklyMeta = weeklyMetaRef.current;
        const payload = serializeWeeklyPersistPayload(fields, weeklyMeta);
        if (!opts?.force && payload === lastPersistedPayloadRef.current) return;
        setSaving(true);
        try {
          await upsertWeeklyReviewJournal({
            week_start_ymd: periodYmd,
            fields,
            execution_score: weeklyMeta.execution_score,
            ai_coaching: weeklyMeta.ai_coaching,
            adjust_tasks: weeklyMeta.adjust_tasks,
            adjust_savings: weeklyMeta.adjust_savings,
            adjust_plans: weeklyMeta.adjust_plans,
          });
          lastPersistedPayloadRef.current = payload;
          flashSaved();
        } catch (e) {
          console.warn('weekly review dimension save', e);
        } finally {
          setSaving(false);
        }
        return;
      }

      const body = serializeReviewBody(fields, meta);
      if (!opts?.force && body === lastPersistedPayloadRef.current) return;
      setSaving(true);
      try {
        if (scope === 'daily') {
          await upsertDailyReviewJournal(periodYmd, body);
          if (periodYmd === todayYmd) {
            void syncDailyReviewReminderNotification();
          }
        } else {
          await upsertMonthlyReviewJournal(periodYmd, body);
        }
        lastPersistedPayloadRef.current = body;
        flashSaved();
      } catch (e) {
        console.warn(`${scope} review dimension save`, e);
      } finally {
        setSaving(false);
      }
    },
    [canEdit, fields, flashSaved, meta, periodYmd, scope, todayYmd],
  );

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

  const runAi = useCallback(async () => {
    if (scope !== 'monthly') return;
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
        periodLabel: periodLabel || formatReviewMonthLabel(periodYmd),
        template,
        fields,
      });
      const nextMeta = { ...meta, ai_analysis: text };
      setMeta(nextMeta);
      const body = serializeReviewBody(fields, nextMeta);
      await upsertMonthlyReviewJournal(periodYmd, body);
      lastPersistedPayloadRef.current = body;
      flashSaved();
    } catch (e) {
      console.warn('monthly review dimension ai analysis', e);
      Alert.alert('分析失败', '请稍后重试。');
    } finally {
      setAiBusy(false);
    }
  }, [canEdit, fields, flashSaved, meta, periodLabel, periodYmd, persist, scope, template]);

  const applyToolbarAction = useCallback(
    async (kind: 'font' | 'todo' | 'image' | 'time' | 'undo' | 'redo') => {
      if (!canEdit || !activeColumn) return;
      const columnId = activeColumn.id;
      const currentModel = fieldModels[columnId] ?? emptyReviewFieldModel();
      const editorState = editorStateByColumn[columnId] ?? DEFAULT_EDITOR_STATE;
      const currentSerialized = serializeReviewFieldContent(currentModel);

      if (kind === 'undo') {
        const undoStack = undoStacksRef.current[columnId] ?? [];
        if (undoStack.length === 0) return;
        const previous = undoStack[undoStack.length - 1];
        undoStacksRef.current[columnId] = undoStack.slice(0, -1);
        redoStacksRef.current[columnId] = [...(redoStacksRef.current[columnId] ?? []), currentSerialized].slice(
          -MAX_HISTORY,
        );
        const restored = parseReviewFieldContent(previous);
        setFieldModels(prev => ({ ...prev, [columnId]: restored }));
        setEditorStateByColumn(prev => ({
          ...prev,
          [columnId]: { blockIndex: 0, selection: { start: 0, end: 0 } },
        }));
        setActiveColumnId(columnId);
        return;
      }

      if (kind === 'redo') {
        const redoStack = redoStacksRef.current[columnId] ?? [];
        if (redoStack.length === 0) return;
        const nextValue = redoStack[redoStack.length - 1];
        redoStacksRef.current[columnId] = redoStack.slice(0, -1);
        undoStacksRef.current[columnId] = [...(undoStacksRef.current[columnId] ?? []), currentSerialized].slice(
          -MAX_HISTORY,
        );
        const restored = parseReviewFieldContent(nextValue);
        setFieldModels(prev => ({ ...prev, [columnId]: restored }));
        setEditorStateByColumn(prev => ({
          ...prev,
          [columnId]: { blockIndex: 0, selection: { start: 0, end: 0 } },
        }));
        setActiveColumnId(columnId);
        return;
      }

      const block = currentModel.blocks[editorState.blockIndex];
      if (!block || block.kind !== 'text') {
        if (kind === 'image') {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.85,
            selectionLimit: 1,
          });
          if (result.canceled || result.assets.length === 0) return;
          const asset = result.assets[0];
          if (!asset?.uri) return;
          const inserted = insertImageBlock(currentModel, currentModel.blocks.length - 1, { start: 0, end: 0 }, asset.uri);
          commitFieldModel(columnId, inserted.model, {
            editorState: { blockIndex: inserted.focusBlockIndex, selection: inserted.selection },
          });
        }
        return;
      }

      if (kind === 'font') {
        const result = applyFontSizeToTextModel(block.model, editorState.selection);
        const nextBlocks = currentModel.blocks.map((b, idx) =>
          idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
        );
        commitFieldModel(columnId, { blocks: nextBlocks }, {
          editorState: { ...editorState, selection: result.selection },
        });
        return;
      }

      if (kind === 'todo') {
        const result = toggleTodoAtSelection(block.model, editorState.selection);
        const nextBlocks = currentModel.blocks.map((b, idx) =>
          idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
        );
        commitFieldModel(columnId, { blocks: nextBlocks }, {
          editorState: { ...editorState, selection: result.selection },
        });
        return;
      }

      if (kind === 'time') {
        const result = insertTextIntoTextModel(block.model, editorState.selection, `${getNowTimeText()} `);
        const nextBlocks = currentModel.blocks.map((b, idx) =>
          idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
        );
        commitFieldModel(columnId, { blocks: nextBlocks }, {
          editorState: { ...editorState, selection: result.selection },
        });
        return;
      }

      if (kind === 'image') {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: false,
          quality: 0.85,
          selectionLimit: 1,
        });
        if (result.canceled || result.assets.length === 0) return;
        const asset = result.assets[0];
        if (!asset?.uri) return;
        const inserted = insertImageBlock(currentModel, editorState.blockIndex, editorState.selection, asset.uri);
        commitFieldModel(columnId, inserted.model, {
          editorState: { blockIndex: inserted.focusBlockIndex, selection: inserted.selection },
        });
      }
    },
    [activeColumn, canEdit, commitFieldModel, editorStateByColumn, fieldModels],
  );

  if (!periodYmd || !dimensionId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <ScreenHeader title={fallbackTitle} onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={{ color: colors.textMuted }}>无效参数</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader
        title={dimensionTitle || fallbackTitle}
        subtitle={periodLabel || undefined}
        onBack={() => router.back()}
        right={
          <Pressable
            style={styles.headerSaveBtn}
            disabled={!canEdit || saving}
            onPress={() => void persist({ force: true })}
            accessibilityRole="button"
            accessibilityLabel="保存">
            {saving ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[Typography.bodyStrong, { color: canEdit ? colors.primary : colors.textMuted }]}>保存</Text>
            )}
          </Pressable>
        }
      />
      {loading ? (
        <ReviewDimensionSkeleton />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}>
          <View style={styles.screenBody}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.scroll,
                { paddingBottom: Spacing['6xl'] + 92 + Math.max(insets.bottom, Spacing.lg) },
              ]}>
              {dimension ? (
                <View style={styles.fieldList}>
                  {dimension.columns.map(col => {
                    const model = fieldModels[col.id] ?? emptyReviewFieldModel();
                    const active = activeColumnId === col.id;
                    const editorState = editorStateByColumn[col.id] ?? DEFAULT_EDITOR_STATE;
                    return (
                      <View
                        key={col.id}
                        style={[
                          styles.fieldCard,
                          Shadows.card,
                          {
                            backgroundColor: colors.surface,
                            borderColor: active ? colors.primary : colors.outline,
                          },
                        ]}>
                        <Text style={[Typography.caption, { color: active ? colors.primary : colors.textMuted }]}>
                          {col.title}
                        </Text>
                        <ReviewFieldEditor
                          model={model}
                          onChange={nextModel => commitFieldModel(col.id, nextModel)}
                          editorState={editorState}
                          onEditorStateChange={state => {
                            setActiveColumnId(col.id);
                            setEditorStateByColumn(prev => ({ ...prev, [col.id]: state }));
                          }}
                          controlledSelection={controlledSelectionByColumn[col.id]}
                          onClearControlledSelection={() =>
                            setControlledSelectionByColumn(prev => ({ ...prev, [col.id]: undefined }))
                          }
                          placeholder={col.placeholder || '开始记录…'}
                          editable={canEdit}
                          textColor={colors.text}
                          placeholderColor={colors.textMuted}
                          caretColor={colors.primary}
                          backgroundColor={colors.input}
                          containerStyle={styles.editor}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {scope === 'monthly' ? (
                <View style={styles.aiPanelWrap}>
                  <ReviewAiAnalysisPanel
                    text={meta.ai_analysis}
                    busy={aiBusy}
                    canRun={canEdit}
                    onAnalyze={() => void runAi()}
                    disabledReason={!canEdit ? '未来月份不可生成分析' : undefined}
                  />
                </View>
              ) : null}

              {savedFlash || saving ? (
                <Text
                  style={[
                    Typography.caption,
                    { color: saving ? colors.textMuted : colors.primary, textAlign: 'center' },
                  ]}>
                  {saving ? '保存中…' : '已自动保存'}
                </Text>
              ) : null}
            </ScrollView>

            <View
              style={[
                styles.toolbarWrap,
                Shadows.composer,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.outline,
                  paddingBottom: Math.max(insets.bottom, Spacing.sm),
                },
              ]}>
              <View style={styles.toolbarRow}>
                <ToolButton
                  label={`A${fontSizeLabel}`}
                  icon="format-size"
                  color={colors.textMuted}
                  onPress={() => applyToolbarAction('font')}
                  disabled={!canEdit || !activeColumn || !activeTextModel}
                />
                <ToolButton
                  label="待办"
                  icon="check-box-outline-blank"
                  color={colors.textMuted}
                  onPress={() => applyToolbarAction('todo')}
                  disabled={!canEdit || !activeColumn || !activeTextModel}
                />
                <ToolButton
                  label="图片"
                  icon="image"
                  color={colors.textMuted}
                  onPress={() => applyToolbarAction('image')}
                  disabled={!canEdit || !activeColumn}
                />
                <ToolButton
                  label="时间"
                  icon="schedule"
                  color={colors.textMuted}
                  onPress={() => applyToolbarAction('time')}
                  disabled={!canEdit || !activeColumn || !activeTextModel}
                />
                <ToolButton
                  label="撤销"
                  icon="undo"
                  color={colors.textMuted}
                  onPress={() => applyToolbarAction('undo')}
                  disabled={!canEdit || !activeColumn}
                />
                <ToolButton
                  label="反撤销"
                  icon="redo"
                  color={colors.textMuted}
                  onPress={() => applyToolbarAction('redo')}
                  disabled={!canEdit || !activeColumn}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function ToolButton({
  label,
  icon,
  color,
  onPress,
  disabled,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  color: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.toolBtn,
        {
          opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}>
      <MaterialIcons name={icon} size={18} color={color} />
      <Text style={[styles.toolBtnText, { color, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screenBody: { flex: 1 },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing.xl,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  fieldList: { gap: Spacing['3xl'] },
  fieldCard: {
    gap: Spacing.md,
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
  },
  editor: {
    minHeight: 320,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing['3xl'],
  },
  aiPanelWrap: {
    marginHorizontal: -Layout.pagePaddingX,
  },
  toolbarWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.md,
    paddingHorizontal: Layout.pagePaddingX,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    justifyContent: 'space-between',
  },
  toolBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 2,
  },
  toolBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
  headerSaveBtn: {
    minWidth: Layout.iconButtonSize,
    minHeight: Layout.iconButtonSize,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
});
