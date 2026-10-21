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
  getYesterdayYmd,
  isMonthlyReviewEditable,
  loadReviewPeriodSnapshot,
  monthEndYmdFromMonthStart,
  rollupMonthlyFieldsFromWeeklyJournals,
  rollupWeeklyFieldsFromDailyEntries,
} from '@/components/review/review-utils';
import { FoldIconButton, FoldPillButton, foldDimensionGlyph, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { Layout, Radius, Spacing } from '@/constants/design-tokens';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi } from '@/lib/review-ai-analysis';
import { loadReviewDayFacts, type ReviewDayFacts } from '@/lib/review-day-facts';
import {
  applyFontSizeToTextModel,
  emptyReviewFieldModel,
  getNowTimeText,
  insertImageBlock,
  insertTextIntoTextModel,
  parseReviewFieldContent,
  reviewContentToPlainDisplay,
  serializeReviewFieldContent,
  toggleTodoAtSelection,
  type ReviewFieldModel,
  type TextSelection,
} from '@/lib/review-journal-format';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { listDailyReviewsBetween, upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
import {
  getMonthlyReviewJournalByMonth,
  upsertMonthlyReviewJournal,
} from '@/lib/repositories/insights/monthly-review-journal';
import {
  collectColumnIds,
  emptyFieldValues,
  migrateMonthlyLegacyFields,
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
  const { fold, isDark } = useFoldTheme();
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
  const [todayFacts, setTodayFacts] = useState<ReviewDayFacts | null>(null);
  const [yesterdayFacts, setYesterdayFacts] = useState<ReviewDayFacts | null>(null);

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
            await fetchReviewJournal({ scope: 'daily', start: periodYmd, end: periodYmd });
          } else {
            await Promise.all([
              fetchReviewCatalog({ scope }),
              fetchReviewJournal({
                scope,
                weekStart: scope === 'weekly' ? periodYmd : undefined,
                monthStart: scope === 'monthly' ? periodYmd : undefined,
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
          const parsed = rollupWeeklyFieldsFromDailyEntries(
            parseWeeklyReviewFields(row, colIds),
            snapshot.dailyEntries,
            snapshot.reviewCycleEndYmd,
            snapshot.configuredDow,
          );
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

        const monthEnd = monthEndYmdFromMonthStart(periodYmd);
        if (shouldFetchReviewFromApi()) {
          await fetchReviewJournal({
            scope: 'weekly',
            start: periodYmd,
            end: monthEnd,
          });
        }
        const [tpl, row] = await Promise.all([
          listReviewTemplate('monthly'),
          getMonthlyReviewJournalByMonth(periodYmd),
        ]);
        const colIds = collectColumnIds(tpl);
        const journal = parseDailyReviewJournal(row?.body ?? null, colIds);
        const migrated = migrateMonthlyLegacyFields(journal.fields, row?.body);
        const rolled = await rollupMonthlyFieldsFromWeeklyJournals(migrated, periodYmd);
        const models = fieldValuesToModels(rolled);
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

  /** 日维度详情：拉取当日与昨日健康事实，用于「昨日对照」只读卡 */
  useEffect(() => {
    if (scope !== 'daily' || !periodYmd) return;
    let cancelled = false;
    void (async () => {
      const yesterday = getYesterdayYmd(periodYmd);
      const [today, prev] = await Promise.all([
        loadReviewDayFacts(periodYmd).catch(() => null),
        loadReviewDayFacts(yesterday).catch(() => null),
      ]);
      if (cancelled) return;
      setTodayFacts(today);
      setYesterdayFacts(prev);
    })();
    return () => {
      cancelled = true;
    };
  }, [periodYmd, scope]);

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
          toast.error(toUserMessage(e, '复盘保存失败，请稍后重试'));
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
        toast.error(toUserMessage(e, '复盘保存失败，请稍后重试'));
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
      toast.error(toUserMessage(e, '分析失败，请稍后重试'));
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

  const insertTimeIntoColumn = useCallback(
    async (columnId: string) => {
      if (!canEdit) return;
      const model = fieldModels[columnId] ?? emptyReviewFieldModel();
      const editorState = editorStateByColumn[columnId] ?? DEFAULT_EDITOR_STATE;
      const block = model.blocks[editorState.blockIndex];
      if (!block || block.kind !== 'text') {
        const result = insertTextIntoTextModel(
          { plain: '', styles: [] },
          { start: 0, end: 0 },
          `${getNowTimeText()} `,
        );
        commitFieldModel(columnId, { blocks: [...model.blocks, { kind: 'text', model: result.model }] });
        return;
      }
      const result = insertTextIntoTextModel(block.model, editorState.selection, `${getNowTimeText()} `);
      const nextBlocks = model.blocks.map((b, idx) =>
        idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
      );
      commitFieldModel(columnId, { blocks: nextBlocks }, {
        editorState: { ...editorState, selection: result.selection },
      });
    },
    [canEdit, commitFieldModel, editorStateByColumn, fieldModels],
  );

  const scopeLabel = scope === 'daily' ? '日复盘' : scope === 'weekly' ? '周复盘' : '月复盘';
  const headerTitle = `${dimensionTitle || fallbackTitle} · ${scopeLabel}`;
  const columnCount = dimension?.columns.length ?? 0;
  const periodCaption = useMemo(() => {
    if (scope === 'daily') return periodYmd.replace(/-/g, '.');
    return periodLabel || periodYmd;
  }, [periodLabel, periodYmd, scope]);
  const headerSubtitle = `${periodCaption} · ${columnCount} 个栏目`;
  const wordCount = dimension
    ? dimension.columns.reduce(
        (sum, col) => sum + reviewContentToPlainDisplay(fields[col.id] ?? '').replace(/\s/g, '').length,
        0,
      )
    : 0;

  const openDimension = (nextId: string) => {
    if (nextId === dimensionId || !periodYmd) return;
    if (scope === 'daily') {
      router.replace({ pathname: '/daily-review/[ymd]/[dimensionId]', params: { ymd: periodYmd, dimensionId: nextId } });
    } else if (scope === 'weekly') {
      router.replace({
        pathname: '/weekly-review/[weekStartYmd]/[dimensionId]',
        params: { weekStartYmd: periodYmd, dimensionId: nextId },
      });
    } else {
      router.replace({
        pathname: '/monthly-review/[monthStartYmd]/[dimensionId]',
        params: { monthStartYmd: periodYmd, dimensionId: nextId },
      });
    }
  };

  const yesterdayRows = useMemo(() => {
    if (scope !== 'daily' || !todayFacts || !yesterdayFacts) return [];
    const rows = [
      {
        label: '热量',
        current: Math.round(todayFacts.health.calories),
        prev: Math.round(yesterdayFacts.health.calories),
      },
      {
        label: '饮水',
        current: Math.round(todayFacts.health.hydration),
        prev: Math.round(yesterdayFacts.health.hydration),
      },
      {
        label: '任务',
        current: todayFacts.tasks.length,
        prev: yesterdayFacts.tasks.length,
      },
    ];
    return rows.filter(row => row.current > 0 || row.prev > 0);
  }, [scope, todayFacts, yesterdayFacts]);

  if (!periodYmd || !dimensionId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]}>
        <View style={styles.invalidBar}>
          <FoldIconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="返回" />
          <Text style={[styles.invalidTitle, { color: fold.ink, fontFamily: foldFonts.serif }]}>{fallbackTitle}</Text>
          <View style={{ width: 34 }} />
        </View>
        <View style={styles.centered}>
          <Text style={{ color: fold.muted }}>无效参数</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <View style={styles.appbarSide}>
          <FoldIconButton icon="arrow-back" onPress={() => router.back()} accessibilityLabel="返回" />
        </View>
        <View style={styles.appbarCenter}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}
            style={[styles.appbarTitle, { color: fold.ink, fontFamily: foldFonts.serif }]}>
            {headerTitle}
          </Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.appbarSub, { color: fold.muted }]}>
            {headerSubtitle}
          </Text>
        </View>
        <View style={[styles.appbarSide, styles.appbarSideRight]}>
          <FoldPillButton
            label={saving ? '保存中' : '保存'}
            variant="solid"
            onPress={() => void persist({ force: true })}
            disabled={!canEdit || saving}
          />
        </View>
      </View>
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
                { paddingBottom: Spacing['6xl'] + 132 + Math.max(insets.bottom, Spacing.lg) },
              ]}>
              {template.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.pillRow}>
                  {template.map(dimItem => {
                    const active = dimItem.id === dimensionId;
                    return (
                      <Pressable
                        key={dimItem.id}
                        onPress={() => openDimension(dimItem.id)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: active }}
                        style={[
                          styles.dimPill,
                          {
                            backgroundColor: active ? fold.pineButton : fold.cardSoft,
                            borderColor: active ? fold.pineButton : fold.line,
                          },
                        ]}>
                        <Text
                          style={[styles.dimPillText, { color: active ? fold.onPineButton : fold.muted }]}
                          maxFontSizeMultiplier={1.25}>
                          {foldDimensionGlyph(dimItem.id)} {dimItem.title}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              <View style={styles.contextRow}>
                <View style={styles.contextLeft}>
                  <View style={[styles.contextDot, { backgroundColor: canEdit ? fold.sage : fold.faint }]} />
                  <Text maxFontSizeMultiplier={1.3} style={[styles.contextText, { color: fold.muted }]}>
                    {canEdit ? '可编辑 · 今日 · 自动保存已开启' : '只读 · 当前周期不可编辑'}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={1.3} style={[styles.contextText, { color: fold.faint }]}>
                  字数 {wordCount}
                </Text>
              </View>

              {dimension ? (
                <View style={styles.fieldList}>
                  {dimension.columns.map((col, index) => {
                    const model = fieldModels[col.id] ?? emptyReviewFieldModel();
                    const active = activeColumnId === col.id;
                    const editorState = editorStateByColumn[col.id] ?? DEFAULT_EDITOR_STATE;
                    return (
                      <View
                        key={col.id}
                        style={[
                          styles.fieldCard,
                          {
                            backgroundColor: fold.card,
                            borderColor: active ? fold.sage : fold.line,
                          },
                        ]}>
                        <View style={styles.fieldHead}>
                          <View style={[styles.fieldIndex, { backgroundColor: fold.paper2 }]}>
                            <Text style={[styles.fieldIndexText, { color: fold.muted }]}>
                              {String(index + 1).padStart(2, '0')}
                            </Text>
                          </View>
                          <Text style={[styles.fieldTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
                            {col.title}
                          </Text>
                          <View style={styles.fieldTools}>
                            <FoldIconButton
                              icon="schedule"
                              size={26}
                              onPress={() => {
                                setActiveColumnId(col.id);
                                void insertTimeIntoColumn(col.id);
                              }}
                              accessibilityLabel="插入时间"
                            />
                          </View>
                        </View>
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
                          textColor={fold.ink2}
                          placeholderColor={fold.faint}
                          caretColor={fold.pine}
                          backgroundColor="transparent"
                          containerStyle={styles.editor}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {yesterdayRows.length > 0 ? (
                <View style={[styles.yesterdayCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
                  <View style={styles.yesterdayHead}>
                    <Text style={[styles.fieldTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
                      <Text style={{ color: fold.faint }}>↺ </Text>昨日对照
                    </Text>
                    <Text style={[styles.yesterdayHint, { color: fold.faint }]}>只读 · 昨日</Text>
                  </View>
                  <View style={styles.yesterdayGrid}>
                    {yesterdayRows.map(row => {
                      const delta = row.current - row.prev;
                      return (
                        <View key={row.label} style={[styles.yesterdayCell, { backgroundColor: fold.paper2 }]}>
                          <Text
                            style={[styles.yesterdayValue, { color: fold.pine, fontFamily: foldFonts.mono }]}
                            numberOfLines={1}>
                            {row.current}
                            {delta !== 0 ? (
                              <Text style={{ color: delta > 0 ? fold.amber : fold.sage }}>
                                {' '}
                                {delta > 0 ? '+' : ''}
                                {delta}
                              </Text>
                            ) : null}
                          </Text>
                          <Text style={[styles.yesterdayLabel, { color: fold.muted }]}>{row.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              <View style={styles.hintRow}>
                <MaterialIcons name="image" size={10} color={fold.faint} />
                <Text style={[styles.hintText, { color: fold.faint }]}>
                  图片块可点击右上角删除 · 每栏撤销 50 步
                </Text>
              </View>

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
            </ScrollView>

            <View style={styles.toolbarArea}>
              <View
                style={[
                  styles.toolbarWrap,
                  {
                    backgroundColor: fold.pineButton,
                    shadowColor: isDark ? '#000000' : '#32362B',
                    paddingBottom: Math.max(insets.bottom, Spacing.lg),
                  },
                ]}>
                <View style={styles.toolbarRow}>
                  <ToolButton
                    label="字号"
                    icon="format-size"
                    color={fold.onPineButton}
                    onPress={() => void applyToolbarAction('font')}
                    disabled={!canEdit || !activeColumn || !activeTextModel}
                    highlight
                  />
                  <ToolButton
                    label="待办"
                    icon="check-box-outline-blank"
                    color={fold.onPineButton}
                    onPress={() => void applyToolbarAction('todo')}
                    disabled={!canEdit || !activeColumn || !activeTextModel}
                  />
                  <ToolButton
                    label="图片"
                    icon="image"
                    color={fold.onPineButton}
                    onPress={() => void applyToolbarAction('image')}
                    disabled={!canEdit || !activeColumn}
                  />
                  <ToolButton
                    label="时间"
                    icon="schedule"
                    color={fold.onPineButton}
                    onPress={() => void applyToolbarAction('time')}
                    disabled={!canEdit || !activeColumn || !activeTextModel}
                  />
                  <View style={[styles.toolbarSep, { backgroundColor: 'rgba(255,255,255,0.15)' }]} />
                  <ToolButton
                    label="撤销"
                    icon="undo"
                    color={fold.onPineButton}
                    onPress={() => void applyToolbarAction('undo')}
                    disabled={!canEdit || !activeColumn}
                  />
                  <ToolButton
                    label="重做"
                    icon="redo"
                    color={fold.onPineButton}
                    onPress={() => void applyToolbarAction('redo')}
                    disabled={!canEdit || !activeColumn}
                  />
                </View>
                <View style={styles.saveBar}>
                  <View
                    style={[
                      styles.saveDot,
                      { backgroundColor: saving ? fold.amber : savedFlash ? fold.sage : 'rgba(255,255,255,0.35)' },
                    ]}
                  />
                  <Text style={[styles.saveText, { color: 'rgba(246,241,230,0.72)' }]}>
                    {saving ? '保存中…' : savedFlash ? '已自动保存 · 刚刚' : '自动保存已开启'}
                  </Text>
                </View>
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
  highlight,
}: {
  label: string;
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  color: string;
  onPress: () => void;
  disabled: boolean;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.toolBtn,
        highlight ? styles.toolBtnActive : null,
        {
          opacity: disabled ? 0.35 : pressed ? 0.7 : 1,
        },
      ]}>
      <MaterialIcons name={icon} size={17} color={color} />
      <Text style={[styles.toolBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screenBody: { flex: 1 },
  invalidBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  invalidTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  appbarSide: {
    minWidth: 62,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  appbarSideRight: {
    alignItems: 'flex-end',
  },
  appbarCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  appbarTitle: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  appbarSub: {
    marginTop: 2,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.md,
    gap: Spacing.md,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  pillRow: {
    gap: 5,
    paddingVertical: 2,
    paddingRight: 8,
  },
  dimPill: {
    height: 27,
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimPillText: {
    fontSize: 10,
    fontWeight: '700',
  },  contextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 2,
  },
  contextLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
    minWidth: 0,
  },
  contextDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  contextText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  fieldList: { gap: Spacing.md },
  fieldCard: {
    gap: Spacing.sm,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  fieldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fieldIndex: {
    width: 17,
    height: 17,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldIndexText: {
    fontSize: 8,
    fontWeight: '800',
  },
  fieldTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  fieldTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  editor: {
    minHeight: 120,
    borderRadius: Radius.md,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  yesterdayCard: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 11,
    gap: 6,
  },
  yesterdayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  yesterdayHint: {
    fontSize: 8,
    fontWeight: '600',
  },
  yesterdayGrid: {
    flexDirection: 'row',
    gap: 5,
  },
  yesterdayCell: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 6,
  },
  yesterdayValue: {
    fontSize: 12,
    fontWeight: '700',
  },
  yesterdayLabel: {
    marginTop: 1,
    fontSize: 7.5,
    fontWeight: '600',
  },
  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingTop: 2,
  },
  hintText: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  aiPanelWrap: {
    marginHorizontal: -Layout.pagePaddingX,
  },
  toolbarArea: {
    paddingHorizontal: 10,
    paddingTop: Spacing.md,
    backgroundColor: 'transparent',
  },
  toolbarWrap: {
    borderRadius: 18,
    paddingTop: Spacing.md,
    paddingHorizontal: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 10,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    justifyContent: 'space-between',
  },
  toolbarSep: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    marginHorizontal: 4,
  },
  toolBtn: {
    minWidth: 42,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    paddingVertical: Spacing.sm,
    gap: 2,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  toolBtnText: {
    fontSize: 8,
    fontWeight: '700',
  },
  saveBar: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  saveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  saveText: {
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});
