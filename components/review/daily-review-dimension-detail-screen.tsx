import { ReviewFieldEditor, type ReviewFieldEditorState } from '@/components/review/review-field-editor';
import { ScreenHeader } from '@/components/ui';
import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import { loadReviewPeriodSnapshot, formatReviewHeaderDate } from '@/components/review/review-utils';
import {
  collectColumnIds,
  parseDailyReviewJournal,
  serializeReviewBody,
  type ReviewFieldValues,
  type ReviewJournalMeta,
} from '@/lib/repositories/insights/review-journal-body';
import { syncDailyReviewReminderNotification } from '@/lib/daily-review-reminder-notifications';
import { listDailyReviewsBetween, upsertDailyReviewJournal } from '@/lib/repositories/insights/daily-review-journal';
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
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'daily-review-dimension-detail';
const AUTO_SAVE_MS = 900;
const MAX_HISTORY = 50;

const DEFAULT_EDITOR_STATE: ReviewFieldEditorState = {
  blockIndex: 0,
  selection: { start: 0, end: 0 },
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

export function DailyReviewDimensionDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();
  const { logicalTodayYmd: todayYmd } = useDayBoundary();
  const params = useLocalSearchParams<{ ymd?: string | string[]; dimensionId?: string | string[] }>();
  const ymd = (Array.isArray(params.ymd) ? params.ymd[0] : params.ymd)?.trim() ?? '';
  const dimensionId = (Array.isArray(params.dimensionId) ? params.dimensionId[0] : params.dimensionId)?.trim() ?? '';
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [fieldModels, setFieldModels] = useState<Record<string, ReviewFieldModel>>({});
  const [meta, setMeta] = useState<ReviewJournalMeta>({});
  const [dailyTemplate, setDailyTemplate] = useState<Awaited<ReturnType<typeof loadReviewPeriodSnapshot>>['dailyTemplate']>([]);
  const [dimensionTitle, setDimensionTitle] = useState('');
  const [dateLabel, setDateLabel] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [activeColumnId, setActiveColumnId] = useState('');
  const [editorStateByColumn, setEditorStateByColumn] = useState<Record<string, ReviewFieldEditorState>>({});
  const [controlledSelectionByColumn, setControlledSelectionByColumn] = useState<Record<string, TextSelection | undefined>>({});

  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStacksRef = useRef<Record<string, string[]>>({});
  const redoStacksRef = useRef<Record<string, string[]>>({});

  const dimension = useMemo(() => dailyTemplate.find(d => d.id === dimensionId) ?? null, [dailyTemplate, dimensionId]);
  const activeColumn = useMemo(() => dimension?.columns.find(c => c.id === activeColumnId) ?? dimension?.columns[0] ?? null, [activeColumnId, dimension]);
  const activeEditorState = activeColumnId ? (editorStateByColumn[activeColumnId] ?? DEFAULT_EDITOR_STATE) : DEFAULT_EDITOR_STATE;
  const activeFieldModel = activeColumnId ? (fieldModels[activeColumnId] ?? emptyReviewFieldModel()) : emptyReviewFieldModel();
  const activeTextBlock = activeFieldModel.blocks[activeEditorState.blockIndex];
  const activeTextModel = activeTextBlock?.kind === 'text' ? activeTextBlock.model : null;

  const fontSizeLabel = useMemo(() => {
    if (!activeTextModel) return 15;
    return currentFontSizeLabel(activeTextModel, activeEditorState.selection);
  }, [activeEditorState.selection, activeTextModel]);

  const fields = useMemo(() => fieldModelsToValues(fieldModels), [fieldModels]);

  const commitFieldModel = useCallback((columnId: string, model: ReviewFieldModel, opts?: { editorState?: ReviewFieldEditorState }) => {
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
  }, []);

  const reload = useCallback(async () => {
    if (!ymd || !dimensionId) return;
    hydratedRef.current = false;
    setLoading(true);
    try {
      await wrapLoad(async () => {
        const [snapshot, dailyRows] = await Promise.all([
          loadReviewPeriodSnapshot(todayYmd),
          listDailyReviewsBetween(ymd, ymd),
        ]);
        setDailyTemplate(snapshot.dailyTemplate);
        setCanEdit(ymd <= todayYmd);
        setDateLabel(formatReviewHeaderDate(ymd));

        const entry = snapshot.dailyEntries.find(e => e.ymd === ymd);
        const colIds = collectColumnIds(snapshot.dailyTemplate);
        const journal = parseDailyReviewJournal(dailyRows[0]?.body ?? null, colIds);
        setFieldModels(fieldValuesToModels(journal.fields));
        setMeta(journal.meta);

        const dim = snapshot.dailyTemplate.find(d => d.id === dimensionId);
        const dimColIds = dim?.columns.map(c => c.id) ?? [];
        setDimensionTitle(dim?.title ?? entry?.label ?? '复盘详情');
        setActiveColumnId(dim?.columns[0]?.id ?? '');
        setEditorStateByColumn(emptyEditorStateByColumn(dimColIds));
        setControlledSelectionByColumn({});
        undoStacksRef.current = {};
        redoStacksRef.current = {};
      });
    } catch {
      setFieldModels({});
      setMeta({});
      setDimensionTitle('复盘详情');
      setActiveColumnId('');
      setEditorStateByColumn({});
      setControlledSelectionByColumn({});
      undoStacksRef.current = {};
      redoStacksRef.current = {};
    } finally {
      setLoading(false);
      hydratedRef.current = true;
    }
  }, [dimensionId, todayYmd, wrapLoad, ymd]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
      console.warn('daily review dimension save', e);
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
        redoStacksRef.current[columnId] = [...(redoStacksRef.current[columnId] ?? []), currentSerialized].slice(-MAX_HISTORY);
        const restored = parseReviewFieldContent(previous);
        setFieldModels(prev => ({ ...prev, [columnId]: restored }));
        setEditorStateByColumn(prev => ({ ...prev, [columnId]: { blockIndex: 0, selection: { start: 0, end: 0 } } }));
        setActiveColumnId(columnId);
        return;
      }

      if (kind === 'redo') {
        const redoStack = redoStacksRef.current[columnId] ?? [];
        if (redoStack.length === 0) return;
        const nextValue = redoStack[redoStack.length - 1];
        redoStacksRef.current[columnId] = redoStack.slice(0, -1);
        undoStacksRef.current[columnId] = [...(undoStacksRef.current[columnId] ?? []), currentSerialized].slice(-MAX_HISTORY);
        const restored = parseReviewFieldContent(nextValue);
        setFieldModels(prev => ({ ...prev, [columnId]: restored }));
        setEditorStateByColumn(prev => ({ ...prev, [columnId]: { blockIndex: 0, selection: { start: 0, end: 0 } } }));
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
          commitFieldModel(columnId, inserted.model, { editorState: { blockIndex: inserted.focusBlockIndex, selection: inserted.selection } });
        }
        return;
      }

      if (kind === 'font') {
        const result = applyFontSizeToTextModel(block.model, editorState.selection);
        const nextBlocks = currentModel.blocks.map((b, idx) =>
          idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
        );
        commitFieldModel(columnId, { blocks: nextBlocks }, { editorState: { ...editorState, selection: result.selection } });
        return;
      }

      if (kind === 'todo') {
        const result = toggleTodoAtSelection(block.model, editorState.selection);
        const nextBlocks = currentModel.blocks.map((b, idx) =>
          idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
        );
        commitFieldModel(columnId, { blocks: nextBlocks }, { editorState: { ...editorState, selection: result.selection } });
        return;
      }

      if (kind === 'time') {
        const result = insertTextIntoTextModel(block.model, editorState.selection, `${getNowTimeText()} `);
        const nextBlocks = currentModel.blocks.map((b, idx) =>
          idx === editorState.blockIndex && b.kind === 'text' ? { kind: 'text' as const, model: result.model } : b,
        );
        commitFieldModel(columnId, { blocks: nextBlocks }, { editorState: { ...editorState, selection: result.selection } });
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

  if (!ymd || !dimensionId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
        <ScreenHeader title="复盘详情" onBack={() => router.back()} />
        <View style={styles.centered}>
          <Text style={{ color: colors.textMuted }}>无效参数</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['left', 'right']}>
      <ScreenHeader title={dimensionTitle || '复盘详情'} subtitle={dateLabel || undefined} onBack={() => router.back()} />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
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
                        style={[styles.fieldCard, { borderColor: active ? colors.primary : colors.outline }]}>
                        {dimension.columns.length > 1 ? (
                          <Text style={[styles.fieldLabel, { color: active ? colors.primary : colors.textMuted }]}>{col.title}</Text>
                        ) : null}
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
                          backgroundColor={isDark ? 'rgba(15,23,42,0.35)' : colors.surface}
                          containerStyle={styles.editor}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {savedFlash || saving ? (
                <Text style={[Typography.caption, { color: saving ? colors.textMuted : colors.primary, textAlign: 'center' }]}>
                  {saving ? '保存中…' : '已自动保存'}
                </Text>
              ) : null}
            </ScrollView>

            <View style={[styles.toolbarWrap, { backgroundColor: colors.background, borderTopColor: colors.outline, paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
              <View style={styles.toolbarRow}>
                <ToolButton label={`A${fontSizeLabel}`} icon="format-size" color={colors.textMuted} onPress={() => applyToolbarAction('font')} disabled={!canEdit || !activeColumn || !activeTextModel} />
                <ToolButton label="待办" icon="check-box-outline-blank" color={colors.textMuted} onPress={() => applyToolbarAction('todo')} disabled={!canEdit || !activeColumn || !activeTextModel} />
                <ToolButton label="图片" icon="image" color={colors.textMuted} onPress={() => applyToolbarAction('image')} disabled={!canEdit || !activeColumn} />
                <ToolButton label="时间" icon="schedule" color={colors.textMuted} onPress={() => applyToolbarAction('time')} disabled={!canEdit || !activeColumn || !activeTextModel} />
                <ToolButton label="撤销" icon="undo" color={colors.textMuted} onPress={() => applyToolbarAction('undo')} disabled={!canEdit || !activeColumn} />
                <ToolButton label="反撤销" icon="redo" color={colors.textMuted} onPress={() => applyToolbarAction('redo')} disabled={!canEdit || !activeColumn} />
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
  screenBody: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.xl,
    gap: Spacing.xl,
    maxWidth: Layout.contentMaxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  fieldList: {
    gap: Spacing['3xl'],
  },
  fieldCard: {
    gap: Spacing.sm,
    borderRadius: 20,
    borderWidth: 1,
    padding: Spacing.md,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
    paddingHorizontal: 2,
  },
  editor: {
    minHeight: 320,
    borderRadius: 16,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing['3xl'],
  },
  toolbarWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
    paddingHorizontal: Layout.pagePaddingX,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'space-between',
  },
  toolBtn: {
    minWidth: 42,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 2,
  },
  toolBtnText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
