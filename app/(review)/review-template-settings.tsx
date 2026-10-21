/**
 * 复盘模板设置 · FOLD
 * 对应设计稿：设计/screens/09-复盘模板设置.png
 *
 * 交互要点（精炼步骤）：
 * - 顶部「保存」统一提交草稿，日 / 周 / 月三个 scope 的改动一次落库
 * - 点击维度行就地展开栏目，新增 / 编辑栏目都在展开卡片里完成
 * - 内置维度固定置顶且不可改名删除，内置栏目不可删除
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { KeyboardEvent } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { Spacing } from '@/constants/design-tokens';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { fetchReviewCatalog, shouldFetchReviewFromApi } from '@/lib/review-page-api';
import {
  createReviewColumn,
  createReviewColumnId,
  createReviewDimension,
  createReviewDimensionId,
  deleteReviewColumn,
  deleteReviewDimension,
  ensureBuiltinCascadeReviewModules,
  listReviewTemplate,
  updateReviewColumn,
  updateReviewDimension,
} from '@/lib/repositories/insights/review-template';
import {
  BUILTIN_REVIEW_CUSTOM_SORT_START,
  builtinReviewDimensionId,
  isBuiltinReviewColumnId,
  isBuiltinReviewDimensionId,
  REVIEW_BUILTIN_MODULE_KEYS,
  type ReviewBuiltinModuleKey,
} from '@/lib/repositories/insights/review-template-defaults';
import type {
  ReviewDimensionTemplate,
  ReviewTemplateScope,
} from '@/lib/repositories/insights/review-template.types';

const PAGE_API_KEY = 'review-template-settings';

const SCOPES: ReviewTemplateScope[] = ['daily', 'weekly', 'monthly'];

const SCOPE_LABEL: Record<ReviewTemplateScope, string> = {
  daily: '日复盘',
  weekly: '周复盘',
  monthly: '月复盘',
};

const SCOPE_NOTE: Record<ReviewTemplateScope, string> = {
  daily: '日复盘是每天落笔的最小单位，空栏目会汇总当天已记录的数据。',
  weekly: '周复盘默认汇总近六天日复盘，空栏目可自行补充。',
  monthly: '月复盘默认汇总本月各周复盘，空栏目可自行补充。',
};

type DraftColumn = {
  key: string;
  id: string;
  title: string;
  placeholder: string;
  sortOrder: number;
  builtin: boolean;
  isNew: boolean;
  removed: boolean;
};

type DraftDimension = {
  key: string;
  id: string;
  title: string;
  sortOrder: number;
  builtin: boolean;
  builtinKey: ReviewBuiltinModuleKey | null;
  columns: DraftColumn[];
  isNew: boolean;
  removed: boolean;
};

type Drafts = Record<ReviewTemplateScope, DraftDimension[]>;

type EditorState = {
  mode: 'dimension' | 'column';
  dimensionKey: string;
  columnKey: string | null;
  title: string;
  placeholder: string;
};

function normalizeScope(raw: string | string[] | undefined): ReviewTemplateScope {
  const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
  if (s === 'weekly' || s === 'monthly') return s;
  return 'daily';
}

function resolveBuiltinKey(scope: ReviewTemplateScope, id: string): ReviewBuiltinModuleKey | null {
  for (const key of REVIEW_BUILTIN_MODULE_KEYS) {
    if (id === builtinReviewDimensionId(scope, key)) return key;
  }
  return null;
}

function toDraftDimension(scope: ReviewTemplateScope, dim: ReviewDimensionTemplate): DraftDimension {
  return {
    key: dim.id,
    id: dim.id,
    title: dim.title,
    sortOrder: dim.sortOrder,
    builtin: isBuiltinReviewDimensionId(dim.id),
    builtinKey: resolveBuiltinKey(scope, dim.id),
    isNew: false,
    removed: false,
    columns: dim.columns.map(col => ({
      key: col.id,
      id: col.id,
      title: col.title,
      placeholder: col.placeholder ?? '',
      sortOrder: col.sortOrder,
      builtin: isBuiltinReviewColumnId(col.id),
      isNew: false,
      removed: false,
    })),
  };
}

function cloneDrafts(drafts: Drafts): Drafts {
  return {
    daily: drafts.daily.map(d => ({ ...d, columns: d.columns.map(c => ({ ...c })) })),
    weekly: drafts.weekly.map(d => ({ ...d, columns: d.columns.map(c => ({ ...c })) })),
    monthly: drafts.monthly.map(d => ({ ...d, columns: d.columns.map(c => ({ ...c })) })),
  };
}

function draftSignature(dims: DraftDimension[]): string {
  return dims
    .map(
      dim =>
        `${dim.key}~${dim.title}~${dim.removed ? 1 : 0}~${dim.columns
          .map(col => `${col.key}~${col.title}~${col.placeholder}~${col.removed ? 1 : 0}`)
          .join(',')}`,
    )
    .join('|');
}

function dimensionIcon(
  builtinKey: ReviewBuiltinModuleKey | null,
  isCustom: boolean,
): React.ComponentProps<typeof MaterialIcons>['name'] {
  if (isCustom) return 'dashboard-customize';
  switch (builtinKey) {
    case 'health':
      return 'spa';
    case 'tasks':
      return 'checklist';
    case 'finance':
      return 'account-balance-wallet';
    case 'routine':
      return 'wb-sunny';
    case 'defects':
      return 'visibility';
    case 'ideas':
      return 'auto-awesome';
    default:
      return 'grid-view';
  }
}

function ScopeSegment({
  value,
  dirtyScopes,
  onChange,
}: {
  value: ReviewTemplateScope;
  dirtyScopes: ReviewTemplateScope[];
  onChange: (next: ReviewTemplateScope) => void;
}) {
  const { fold } = useFoldTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;
  const index = Math.max(0, SCOPES.indexOf(value));

  useEffect(() => {
    Animated.spring(anim, {
      toValue: index,
      speed: 18,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  const inner = Math.max(0, trackWidth - 8);
  const segWidth = inner / SCOPES.length;

  return (
    <View
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      style={[styles.scopeTrack, { backgroundColor: fold.paper2, borderColor: fold.line }]}>
      {segWidth > 0 ? (
        <Animated.View
          style={[
            styles.scopeIndicator,
            {
              width: segWidth,
              backgroundColor: fold.card,
              borderColor: fold.line,
              transform: [
                {
                  translateX: anim.interpolate({
                    inputRange: [0, 1, 2],
                    outputRange: [0, segWidth, segWidth * 2],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
      {SCOPES.map(item => {
        const active = item === value;
        const dirty = dirtyScopes.includes(item);
        return (
          <Pressable
            key={item}
            onPress={() => onChange(item)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={SCOPE_LABEL[item]}
            style={({ pressed }) => [styles.scopeItem, { opacity: pressed ? 0.82 : 1 }]}>
            <Text style={[styles.scopeText, { color: active ? fold.pine : fold.muted }]} numberOfLines={1}>
              {SCOPE_LABEL[item]}
            </Text>
            {dirty ? <View style={[styles.scopeDot, { backgroundColor: fold.amber }]} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default function ReviewTemplateSettingsScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold, palette } = useFoldTheme();
  const { scope: scopeParam } = useLocalSearchParams<{ scope?: string }>();

  const [scope, setScope] = useState<ReviewTemplateScope>(normalizeScope(scopeParam));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Drafts>({ daily: [], weekly: [], monthly: [] });
  const [baseline, setBaseline] = useState<Drafts>({ daily: [], weekly: [], monthly: [] });
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [modalKeyboardInset, setModalKeyboardInset] = useState(0);
  const skipFocusReloadRef = useRef(false);

  useEffect(() => {
    if (editor == null) {
      setModalKeyboardInset(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) =>
      setModalKeyboardInset(Math.max(0, Math.round(e.endCoordinates.height)));
    const onHide = () => setModalKeyboardInset(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [editor]);

  const loadDrafts = useCallback(
    async (forceRefresh = false, silent = false) => {
      if (!silent) setLoading(true);
      try {
        await wrapLoad(async () => {
          await ensureBuiltinCascadeReviewModules().catch(() => undefined);
          if (shouldFetchReviewFromApi()) {
            await fetchReviewCatalog({ scope: 'all' });
          }
          const next: Drafts = { daily: [], weekly: [], monthly: [] };
          for (const s of SCOPES) {
            const rows = await listReviewTemplate(s);
            next[s] = rows.map(row => toDraftDimension(s, row));
          }
          setDrafts(next);
          setBaseline(cloneDrafts(next));
          const allKeys = new Set(SCOPES.flatMap(s => next[s].map(d => d.key)));
          setExpandedKey(prev => (prev && allKeys.has(prev) ? prev : null));
        }, forceRefresh);
      } catch {
        Alert.alert('加载失败', '请稍后重试');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [wrapLoad],
  );

  const dirtyScopes = useMemo(
    () => SCOPES.filter(s => draftSignature(drafts[s]) !== draftSignature(baseline[s])),
    [baseline, drafts],
  );
  const dirty = dirtyScopes.length > 0;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const refreshDrafts = useCallback(
    async (forceRefresh?: boolean) => {
      if (dirtyRef.current) return;
      await loadDrafts(forceRefresh ?? false);
    },
    [loadDrafts],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, refreshDrafts);

  useFocusEffect(
    useCallback(() => {
      if (skipFocusReloadRef.current) {
        skipFocusReloadRef.current = false;
        return;
      }
      if (dirtyRef.current) return;
      void loadDrafts();
    }, [loadDrafts]),
  );

  const updateScope = useCallback((next: ReviewTemplateScope) => {
    setScope(next);
    setExpandedKey(null);
  }, []);

  const mutateScope = useCallback(
    (target: ReviewTemplateScope, fn: (dims: DraftDimension[]) => DraftDimension[]) => {
      setDrafts(prev => ({ ...prev, [target]: fn(prev[target]) }));
    },
    [],
  );

  const openAddDimension = () => {
    setEditor({ mode: 'dimension', dimensionKey: '', columnKey: null, title: '', placeholder: '' });
  };

  const openEditDimension = (dim: DraftDimension) => {
    setEditor({
      mode: 'dimension',
      dimensionKey: dim.key,
      columnKey: null,
      title: dim.title,
      placeholder: '',
    });
  };

  const openAddColumn = (dimKey: string) => {
    setEditor({ mode: 'column', dimensionKey: dimKey, columnKey: null, title: '', placeholder: '' });
  };

  const openEditColumn = (dimKey: string, col: DraftColumn) => {
    setEditor({
      mode: 'column',
      dimensionKey: dimKey,
      columnKey: col.key,
      title: col.title,
      placeholder: col.placeholder,
    });
  };

  const onDeleteDimension = (dim: DraftDimension) => {
    if (dim.builtin) {
      Alert.alert('无法删除', '内置维度不可删除或改名。');
      return;
    }
    Alert.alert('删除维度', `确定删除「${dim.title}」及其下全部栏目？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          mutateScope(scope, dims => dims.map(d => (d.key === dim.key ? { ...d, removed: true } : d)));
          if (expandedKey === dim.key) setExpandedKey(null);
        },
      },
    ]);
  };

  const onDeleteColumn = (dimKey: string, col: DraftColumn) => {
    if (col.builtin) {
      Alert.alert('无法删除', '内置栏目不可删除。');
      return;
    }
    Alert.alert('删除栏目', `确定删除「${col.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          mutateScope(scope, dims =>
            dims.map(d =>
              d.key === dimKey
                ? {
                    ...d,
                    columns: d.columns.map(c => (c.key === col.key ? { ...c, removed: true } : c)),
                  }
                : d,
            ),
          );
        },
      },
    ]);
  };

  const onCommitEditor = () => {
    if (!editor) return;
    const title = editor.title.trim();
    if (!title) {
      Alert.alert('无法保存', '请填写名称');
      return;
    }
    if (editor.mode === 'dimension') {
      if (editor.dimensionKey) {
        mutateScope(scope, dims =>
          dims.map(d => (d.key === editor.dimensionKey ? { ...d, title } : d)),
        );
      } else {
        const customSorts = drafts[scope]
          .filter(d => !d.builtin && !d.removed)
          .map(d => d.sortOrder);
        const nextSort = Math.max(BUILTIN_REVIEW_CUSTOM_SORT_START, ...customSorts, 0) + 10;
        const id = createReviewDimensionId();
        mutateScope(scope, dims => [
          ...dims,
          {
            key: id,
            id,
            title,
            sortOrder: nextSort,
            builtin: false,
            builtinKey: null,
            isNew: true,
            removed: false,
            columns: [],
          },
        ]);
        setExpandedKey(id);
      }
    } else {
      const dimKey = editor.dimensionKey;
      if (editor.columnKey) {
        mutateScope(scope, dims =>
          dims.map(d =>
            d.key === dimKey
              ? {
                  ...d,
                  columns: d.columns.map(c =>
                    c.key === editor.columnKey
                      ? { ...c, title, placeholder: editor.placeholder.trim() }
                      : c,
                  ),
                }
              : d,
          ),
        );
      } else {
        const dim = drafts[scope].find(d => d.key === dimKey);
        const nextSort = Math.max(0, ...(dim?.columns ?? []).map(c => c.sortOrder)) + 10;
        const id = createReviewColumnId();
        mutateScope(scope, dims =>
          dims.map(d =>
            d.key === dimKey
              ? {
                  ...d,
                  columns: [
                    ...d.columns,
                    {
                      key: id,
                      id,
                      title,
                      placeholder: editor.placeholder.trim(),
                      sortOrder: nextSort,
                      builtin: false,
                      isNew: true,
                      removed: false,
                    },
                  ],
                }
              : d,
          ),
        );
      }
    }
    setEditor(null);
  };

  const saveDrafts = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      for (const s of SCOPES) {
        const baseDims = baseline[s];
        for (const dim of drafts[s]) {
          const base = baseDims.find(d => d.key === dim.key);
          if (dim.removed) {
            if (base && !base.removed) await deleteReviewDimension(dim.id);
            continue;
          }
          if (!base) {
            await createReviewDimension({
              id: dim.id,
              scope: s,
              title: dim.title,
              sort_order: dim.sortOrder,
            });
            for (const col of dim.columns) {
              if (col.removed) continue;
              await createReviewColumn({
                id: col.id,
                dimension_id: dim.id,
                title: col.title,
                placeholder: col.placeholder.trim() || null,
                sort_order: col.sortOrder,
              });
            }
            continue;
          }
          if (base.title !== dim.title) {
            await updateReviewDimension(dim.id, { title: dim.title });
          }
          for (const col of dim.columns) {
            const baseCol = base.columns.find(c => c.key === col.key);
            if (col.removed) {
              if (baseCol && !baseCol.removed) await deleteReviewColumn(col.id);
              continue;
            }
            if (!baseCol) {
              await createReviewColumn({
                id: col.id,
                dimension_id: dim.id,
                title: col.title,
                placeholder: col.placeholder.trim() || null,
                sort_order: col.sortOrder,
              });
              continue;
            }
            if (baseCol.title !== col.title || baseCol.placeholder !== col.placeholder) {
              await updateReviewColumn(col.id, {
                title: col.title,
                placeholder: col.placeholder.trim() || null,
              });
            }
          }
        }
      }
      skipFocusReloadRef.current = true;
      await loadDrafts(false, true);
      toast.success('模板已保存');
      return true;
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      return false;
    } finally {
      setSaving(false);
    }
  }, [baseline, drafts, loadDrafts]);

  const onBack = useCallback(() => {
    if (!dirty) {
      router.back();
      return;
    }
    Alert.alert('有未保存的修改', '离开前如何处理模板改动？', [
      { text: '继续编辑', style: 'cancel' },
      {
        text: '放弃修改',
        style: 'destructive',
        onPress: () => router.back(),
      },
      {
        text: '保存并返回',
        onPress: () => {
          void saveDrafts().then(ok => {
            if (ok) router.back();
          });
        },
      },
    ]);
  }, [dirty, router, saveDrafts]);

  const visibleDims = useMemo(() => drafts[scope].filter(d => !d.removed), [drafts, scope]);
  const builtinDims = visibleDims.filter(d => d.builtin);
  const customDims = visibleDims.filter(d => !d.builtin);

  const renderExpandCard = (dim: DraftDimension) => {
    const cols = dim.columns.filter(c => !c.removed);
    const builtinCount = cols.filter(c => c.builtin).length;
    return (
      <View style={[styles.expandCard, { backgroundColor: fold.card, borderColor: fold.line2 }]}>
        <View style={[styles.expandHead, { backgroundColor: fold.paper2, borderBottomColor: fold.line }]}>
          <View style={[styles.expandIcon, { backgroundColor: dim.builtin ? fold.sage2 : fold.paper2 }]}>
            <MaterialIcons
              name={dimensionIcon(dim.builtinKey, !dim.builtin)}
              size={12}
              color={dim.builtin ? palette.pine : fold.ink2}
            />
          </View>
          <Text style={[styles.expandTitle, { color: fold.ink }]} numberOfLines={1}>
            {dim.title} · 栏目
          </Text>
          <Text style={[styles.expandMeta, { color: fold.faint }]} numberOfLines={1}>
            {dim.builtin ? `内置栏目不可删 · ${builtinCount} / ${cols.length}` : `${cols.length} 栏`}
          </Text>
          <MaterialIcons name="keyboard-arrow-up" size={16} color={fold.muted} />
        </View>
        {cols.length === 0 ? (
          <Text style={[styles.expandEmpty, { color: fold.faint }]}>还没有栏目，先加一个</Text>
        ) : (
          cols.map(col => (
            <View key={col.key} style={[styles.columnRow, { borderTopColor: fold.line }]}>
              <MaterialIcons name="drag-handle" size={14} color={fold.faint} />
              <View style={styles.columnBody}>
                <Text style={[styles.columnTitle, { color: fold.ink2 }]} numberOfLines={1}>
                  {col.title}
                </Text>
                {col.placeholder ? (
                  <Text style={[styles.columnPlaceholder, { color: fold.faint }]} numberOfLines={1}>
                    {col.placeholder}
                  </Text>
                ) : null}
              </View>
              {col.builtin ? (
                <MaterialIcons name="lock" size={13} color={fold.faint} />
              ) : (
                <View style={styles.moduleActions}>
                  <Pressable
                    onPress={() => openEditColumn(dim.key, col)}
                    hitSlop={8}
                    accessibilityLabel={`编辑栏目 ${col.title}`}
                    style={({ pressed }) => [
                      styles.rowAction,
                      { backgroundColor: fold.paper2, opacity: pressed ? 0.7 : 1 },
                    ]}>
                    <MaterialIcons name="edit" size={13} color={fold.muted} />
                  </Pressable>
                  <Pressable
                    onPress={() => onDeleteColumn(dim.key, col)}
                    hitSlop={8}
                    accessibilityLabel={`删除栏目 ${col.title}`}
                    style={({ pressed }) => [
                      styles.rowAction,
                      { backgroundColor: fold.clay2, opacity: pressed ? 0.7 : 1 },
                    ]}>
                    <MaterialIcons name="delete-outline" size={13} color={palette.clayInk} />
                  </Pressable>
                </View>
              )}
            </View>
          ))
        )}
        <Pressable
          onPress={() => openAddColumn(dim.key)}
          accessibilityRole="button"
          accessibilityLabel="新增栏目"
          style={({ pressed }) => [
            styles.addColumnRow,
            { borderTopColor: fold.line, opacity: pressed ? 0.7 : 1 },
          ]}>
          <MaterialIcons name="add" size={14} color={palette.sage} />
          <Text style={[styles.addColumnText, { color: fold.muted }]}>新增栏目</Text>
        </Pressable>
      </View>
    );
  };

  const renderDimensionRow = (dim: DraftDimension, isLast: boolean) => {
    const open = expandedKey === dim.key;
    const cols = dim.columns.filter(c => !c.removed);
    const meta = cols.map(c => c.title).join(' / ');
    return (
      <View key={dim.key}>
        <Pressable
          onPress={() => setExpandedKey(open ? null : dim.key)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${dim.title}，${cols.length} 栏`}
          style={({ pressed }) => [
            styles.moduleRow,
            {
              borderBottomColor: fold.line,
              borderBottomWidth: isLast && !open ? 0 : StyleSheet.hairlineWidth,
              opacity: pressed ? 0.9 : 1,
            },
          ]}>
          <View style={[styles.moduleIcon, { backgroundColor: dim.builtin ? fold.paper2 : fold.sage2 }]}>
            <MaterialIcons
              name={dimensionIcon(dim.builtinKey, !dim.builtin)}
              size={14}
              color={dim.builtin ? fold.ink2 : palette.pine}
            />
          </View>
          <View style={styles.moduleNameWrap}>
            <Text style={[styles.moduleName, { color: fold.ink2 }]} numberOfLines={1}>
              {dim.title}
            </Text>
            <View style={[styles.countTag, { backgroundColor: dim.builtin ? fold.sage2 : fold.paper2 }]}>
              <Text style={[styles.countTagText, { color: dim.builtin ? palette.sageInk : fold.muted }]}>
                {cols.length} 栏
              </Text>
            </View>
          </View>
          {meta ? (
            <Text style={[styles.moduleMeta, { color: fold.faint }]} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {dim.builtin ? (
            <MaterialIcons name="lock" size={13} color={fold.faint} />
          ) : (
            <View style={styles.moduleActions}>
              <Pressable
                onPress={() => openEditDimension(dim)}
                hitSlop={8}
                accessibilityLabel={`编辑维度 ${dim.title}`}
                style={({ pressed }) => [
                  styles.rowAction,
                  { backgroundColor: fold.paper2, opacity: pressed ? 0.7 : 1 },
                ]}>
                <MaterialIcons name="edit" size={13} color={fold.muted} />
              </Pressable>
              <Pressable
                onPress={() => onDeleteDimension(dim)}
                hitSlop={8}
                accessibilityLabel={`删除维度 ${dim.title}`}
                style={({ pressed }) => [
                  styles.rowAction,
                  { backgroundColor: fold.clay2, opacity: pressed ? 0.7 : 1 },
                ]}>
                <MaterialIcons name="delete-outline" size={13} color={palette.clayInk} />
              </Pressable>
            </View>
          )}
        </Pressable>
        {open ? renderExpandCard(dim) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="返回"
            style={({ pressed }) => [
              styles.backBtn,
              { backgroundColor: fold.paper2, opacity: pressed ? 0.75 : 1 },
            ]}>
            <MaterialIcons name="arrow-back" size={17} color={fold.ink2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text
              style={[styles.headerTitle, { color: fold.ink }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}>
              复盘模板
            </Text>
            <Text
              style={[styles.headerSub, { color: fold.muted }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.3}>
              TEMPLATE · 日 / 周 / 月
            </Text>
          </View>
          <Pressable
            onPress={() => void saveDrafts()}
            disabled={!dirty || saving}
            accessibilityRole="button"
            accessibilityLabel="保存模板"
            accessibilityState={{ disabled: !dirty || saving }}
            style={({ pressed }) => [
              styles.saveBtn,
              {
                borderColor: fold.line2,
                backgroundColor: fold.card,
                opacity: !dirty ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}>
            {saving ? (
              <ActivityIndicator size="small" color={fold.pine} />
            ) : (
              <Text style={[styles.saveText, { color: dirty ? fold.pine : fold.faint }]}>保存</Text>
            )}
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 8}>
        <View style={styles.scopeWrap}>
          <ScopeSegment value={scope} dirtyScopes={dirtyScopes} onChange={updateScope} />
        </View>

        {loading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={fold.pine} />
          </View>
        ) : (
          <ScrollView
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.scroll, { paddingBottom: Spacing['6xl'] + insets.bottom }]}>
            <View style={[styles.note, { backgroundColor: fold.paper2 }]}>
              <MaterialIcons name="auto-awesome" size={12} color={palette.sage} />
              <Text style={[styles.noteText, { color: fold.muted }]}>
                三个 scope 的模板彼此独立。内置维度不可删除 / 改名，必须排在自定义模块之前；内置栏目不可删除。
              </Text>
            </View>

            <View style={styles.groupRow}>
              <Text style={[styles.groupTitle, { color: fold.muted }]}>内置维度 · BUILT-IN</Text>
              <Text style={[styles.groupHint, { color: fold.faint }]}>{builtinDims.length} 个 · 固定置顶</Text>
            </View>
            <View style={[styles.moduleList, { borderColor: fold.line, backgroundColor: fold.cardSoft }]}>
              {builtinDims.length === 0 ? (
                <Text style={[styles.listEmpty, { color: fold.faint }]}>内置维度会自动补齐</Text>
              ) : (
                builtinDims.map((dim, idx) => renderDimensionRow(dim, idx === builtinDims.length - 1))
              )}
            </View>

            <View style={styles.groupRow}>
              <Text style={[styles.groupTitle, { color: fold.muted }]}>自定义维度 · CUSTOM</Text>
              <Text style={[styles.groupHint, { color: fold.faint }]}>移动端暂不支持排序</Text>
            </View>
            <View style={[styles.moduleList, { borderColor: fold.line, backgroundColor: fold.cardSoft }]}>
              {customDims.length === 0 ? (
                <Text style={[styles.listEmpty, { color: fold.faint }]}>还没有自定义维度</Text>
              ) : (
                customDims.map((dim, idx) => renderDimensionRow(dim, idx === customDims.length - 1))
              )}
            </View>

            <Pressable
              onPress={openAddDimension}
              accessibilityRole="button"
              accessibilityLabel="新增维度"
              style={({ pressed }) => [
                styles.addBtn,
                { borderColor: fold.line2, backgroundColor: fold.cardSoft, opacity: pressed ? 0.8 : 1 },
              ]}>
              <MaterialIcons name="add" size={15} color={palette.sage} />
              <Text style={[styles.addBtnText, { color: fold.muted }]}>新增维度</Text>
            </Pressable>

            <Text style={[styles.footerHint, { color: fold.faint }]}>
              {SCOPE_NOTE[scope]}进入页面时自动补齐内置模块，并软删除旧版周 / 月默认维度；APP 共享同一套 ID。
            </Text>
          </ScrollView>
        )}
      </KeyboardAvoidingView>

      <Modal visible={editor != null} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <KeyboardAvoidingView
          style={[styles.modalRoot, { backgroundColor: 'rgba(27,36,31,0.28)' }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setEditor(null)} />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: fold.card,
                borderColor: fold.line,
                paddingBottom: insets.bottom + 16,
                marginBottom: Platform.OS === 'android' ? modalKeyboardInset : 0,
              },
            ]}>
            <View style={[styles.sheetHandle, { backgroundColor: fold.line2 }]} />
            <Text style={[styles.modalTitle, { color: fold.ink }]}>
              {editor?.mode === 'dimension'
                ? editor.dimensionKey
                  ? '编辑维度'
                  : '新增维度'
                : editor?.columnKey
                  ? '编辑栏目'
                  : '新增栏目'}
            </Text>
            <Text style={[styles.fieldLabel, { color: fold.muted }]}>名称</Text>
            <TextInput
              value={editor?.title ?? ''}
              onChangeText={t => setEditor(prev => (prev ? { ...prev, title: t } : prev))}
              placeholder={editor?.mode === 'dimension' ? '例如：今日总结' : '例如：完成任务'}
              placeholderTextColor={fold.faint}
              style={[
                styles.input,
                { backgroundColor: fold.paper2, borderColor: fold.line, color: fold.ink },
              ]}
            />
            {editor?.mode === 'column' ? (
              <>
                <Text style={[styles.fieldLabel, { color: fold.muted }]}>填写提示（可选）</Text>
                <TextInput
                  value={editor.placeholder}
                  onChangeText={t => setEditor(prev => (prev ? { ...prev, placeholder: t } : prev))}
                  placeholder="输入框占位说明"
                  placeholderTextColor={fold.faint}
                  multiline
                  style={[
                    styles.input,
                    styles.inputMulti,
                    { backgroundColor: fold.paper2, borderColor: fold.line, color: fold.ink },
                  ]}
                />
              </>
            ) : null}
            <View style={styles.modalBtns}>
              <Pressable
                onPress={() => setEditor(null)}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { borderColor: fold.line, opacity: pressed ? 0.8 : 1 },
                ]}>
                <Text style={[styles.modalBtnText, { color: fold.muted }]}>取消</Text>
              </Pressable>
              <Pressable
                onPress={onCommitEditor}
                style={({ pressed }) => [
                  styles.modalBtn,
                  { backgroundColor: fold.pine, borderColor: fold.pine, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={[styles.modalBtnText, { color: fold.onPineButton }]}>确定</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontFamily: foldFonts.serif,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1.4,
  },
  saveBtn: {
    minWidth: 52,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  saveText: { fontSize: 12, fontWeight: '700' },
  scopeWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  scopeTrack: {
    flexDirection: 'row',
    height: 36,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    position: 'relative',
  },
  scopeIndicator: {
    position: 'absolute',
    top: 3,
    left: 3,
    bottom: 3,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#23443A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
  },
  scopeItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    zIndex: 2,
  },
  scopeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  scopeDot: { width: 5, height: 5, borderRadius: 3 },
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  noteText: { flex: 1, fontSize: 11, lineHeight: 16 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 2,
  },
  groupTitle: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  groupHint: { fontSize: 10 },
  moduleList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  listEmpty: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 14 },
  moduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomColor: 'rgba(216,205,187,0.5)',
  },
  moduleIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moduleNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  moduleName: { fontSize: 13.5, fontWeight: '800', flexShrink: 1 },
  countTag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countTagText: { fontSize: 10, fontWeight: '700' },
  moduleMeta: { flex: 1, fontSize: 10.5, textAlign: 'right' },
  moduleActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowAction: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandCard: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginHorizontal: 8,
    marginBottom: 8,
  },
  expandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  expandIcon: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandTitle: { flex: 1, fontSize: 13, fontWeight: '800' },
  expandMeta: { fontSize: 10 },
  expandEmpty: { fontSize: 11.5, paddingHorizontal: 12, paddingVertical: 12 },
  columnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  columnBody: { flex: 1, minWidth: 0 },
  columnTitle: { fontSize: 12.5, fontWeight: '700' },
  columnPlaceholder: { fontSize: 10.5, marginTop: 2 },
  addColumnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(216,205,187,0.5)',
  },
  addColumnText: { fontSize: 11.5, fontWeight: '600' },
  addBtn: {
    height: 38,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 2,
  },
  addBtnText: { fontSize: 12.5, fontWeight: '700' },
  footerHint: {
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 10,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 10,
    gap: 8,
  },
  sheetHandle: {
    width: 34,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 4,
  },
  modalTitle: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  fieldLabel: { fontSize: 11, fontWeight: '700', marginTop: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 12 },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  modalBtnText: { fontSize: 13.5, fontWeight: '800' },
});
