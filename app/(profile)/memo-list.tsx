import { CrudListScreen, ScreenEmptyState } from '@/components/crud';
import { AppIconButton } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { createProjectFromMemoInInbox } from '@/lib/memo-to-project';
import { createStandaloneTodoFromMemo } from '@/lib/memo-to-task';
import {
  deleteMemo,
  listMemos,
  memoContextForAiReview,
  memoListPreviewBody,
  memoListPreviewTitle,
  memoMatchesSearch,
  runMemoAiReviewOnServer,
  setMemoAiReview,
  setMemoPinned,
  sortMemos,
  type MemoItem,
  type MemoSortMode,
} from '@/lib/memos';
import {
  addMemoAiPendingAnalysisListener,
  addMemoAiReviewSavedListener,
} from '@/lib/memo-ai-background';
import { analyzeMemoReviewFromText, getActiveAiLlmApiKey, isActiveAiLlmConfigured } from '@/lib/zhipu-image-parse';
import { getTags, getTagsByEntityIds } from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { MaterialIcons } from '@expo/vector-icons';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { fetchProfileMemoList } from '@/lib/profile-page-api';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MEMO_LIST_PAGE_KEY = 'memo-list';
const TAG_FILTER_ALL = '__all__';
const TAG_FILTER_NONE = '__none__';

const SORT_OPTIONS: { id: MemoSortMode; label: string }[] = [
  { id: 'updated', label: '最近更新' },
  { id: 'created', label: '最近创建' },
  { id: 'title', label: '标题' },
];

type ListRow =
  | { kind: 'section'; key: string; label: string }
  | { kind: 'memo'; key: string; item: MemoItem };

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function sectionLabelForDay(ymd: string, now = new Date()): string {
  if (ymd === 'unknown') return '未知日期';
  const today = dayKey(now.toISOString());
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const yesterday = dayKey(yest.toISOString());
  if (ymd === today) return '今天';
  if (ymd === yesterday) return '昨天';
  const [y, m, d] = ymd.split('-');
  return `${Number(y)}年${Number(m)}月${Number(d)}日`;
}

function buildTimelineRows(items: MemoItem[], sortMode: MemoSortMode): ListRow[] {
  const sorted = sortMemos(items, sortMode);
  if (sortMode === 'title') {
    return sorted.map(item => ({ kind: 'memo' as const, key: item.id, item }));
  }
  const out: ListRow[] = [];
  let lastSection = '';
  for (const item of sorted) {
    const iso = sortMode === 'created' ? item.created_at : item.updated_at;
    const ymd = dayKey(iso);
    if (ymd !== lastSection) {
      lastSection = ymd;
      out.push({ kind: 'section', key: `s-${ymd}`, label: sectionLabelForDay(ymd) });
    }
    out.push({ kind: 'memo', key: item.id, item });
  }
  return out;
}

function timeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export default function MemoListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();

  const paper = colors.background;
  const ink = colors.text;
  const muted = colors.textSecondary;
  const line = isDark ? 'rgba(148,163,184,0.22)' : colors.outlineStrong;
  const chipBg = isDark ? colors.surfaceMuted : colors.surface;
  const searchBg = isDark ? colors.input : colors.surface;
  const primary = colors.primary;
  const secondary = colors.secondary;
  const danger = colors.danger;

  const zhipuReady = isActiveAiLlmConfigured();

  const [items, setItems] = useState<MemoItem[]>([]);
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const [tagsByMemoId, setTagsByMemoId] = useState<Map<string, TagRow[]>>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState(TAG_FILTER_ALL);
  const [sortMode, setSortMode] = useState<MemoSortMode>('updated');
  const [sortMenuVisible, setSortMenuVisible] = useState(false);

  const [aiModalId, setAiModalId] = useState<string | null>(null);
  const [aiModalLoading, setAiModalLoading] = useState(false);
  const [convertingMemoId, setConvertingMemoId] = useState<string | null>(null);
  const [pendingAnalysisIds, setPendingAnalysisIds] = useState<ReadonlySet<string>>(() => new Set());

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const { wrapLoad, resetSync } = usePageApiSync(MEMO_LIST_PAGE_KEY);

  useEffect(() => addMemoAiPendingAnalysisListener(setPendingAnalysisIds), []);
  useEffect(() => {
    return addMemoAiReviewSavedListener(row => {
      setItems(prev => {
        const idx = prev.findIndex(m => m.id === row.id);
        if (idx < 0) return [row, ...prev];
        return prev.map(m => (m.id === row.id ? { ...m, ...row } : m));
      });
    });
  }, []);

  const reload = useCallback(
    async (forceApi = false) => {
      setError(null);
      try {
        await wrapLoad(async () => {
          await fetchProfileMemoList({ offlineFallback: true });
          const [memos, tags] = await Promise.all([listMemos(), getTags()]);
          setItems(memos);
          setAllTags(tags);
          const map = await getTagsByEntityIds(
            'memo',
            memos.map(m => m.id),
          );
          setTagsByMemoId(map);
        }, forceApi);
      } catch {
        setError('加载失败，请重试');
        setItems([]);
        setAllTags([]);
        setTagsByMemoId(new Map());
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(MEMO_LIST_PAGE_KEY, reload);
  usePageFocusReload(MEMO_LIST_PAGE_KEY, reload);

  const aiModalItem = useMemo(
    () => (aiModalId ? items.find(i => i.id === aiModalId) ?? null : null),
    [aiModalId, items],
  );

  const filteredItems = useMemo(() => {
    let list = items.filter(m => memoMatchesSearch(m, search));
    if (tagFilter === TAG_FILTER_NONE) {
      list = list.filter(m => !(tagsByMemoId.get(m.id)?.length));
    } else if (tagFilter !== TAG_FILTER_ALL) {
      list = list.filter(m => (tagsByMemoId.get(m.id) ?? []).some(t => t.id === tagFilter));
    }
    return list;
  }, [items, search, tagFilter, tagsByMemoId]);

  const listRows = useMemo(
    () => buildTimelineRows(filteredItems, sortMode),
    [filteredItems, sortMode],
  );

  const usedTags = useMemo(() => {
    const ids = new Set<string>();
    for (const list of tagsByMemoId.values()) {
      for (const t of list) ids.add(t.id);
    }
    return allTags.filter(t => ids.has(t.id));
  }, [allTags, tagsByMemoId]);

  const runAiForMemo = useCallback(async (row: MemoItem): Promise<{ ok: true } | { ok: false; error: string }> => {
    const ctx = memoContextForAiReview(row);
    if (!ctx) return { ok: false, error: '该备忘标题与正文均为空' };
    try {
      const saved = await runMemoAiReviewOnServer(row.id);
      if (saved) {
        setItems(prev =>
          prev.map(m =>
            m.id === row.id
              ? {
                  ...m,
                  ai_evaluation: saved.ai_evaluation,
                  ai_suggestions: saved.ai_suggestions,
                  ai_review_at: saved.ai_review_at,
                }
              : m,
          ),
        );
        return { ok: true };
      }
    } catch (e) {
      if (__DEV__) console.warn('[memo-list] ai-review failed, fallback', e);
    }
    const key = getActiveAiLlmApiKey().trim();
    if (!key) return { ok: false, error: '未配置服务器 AI（请先登录）' };
    const r = await analyzeMemoReviewFromText({ apiKey: key, memoContextText: ctx });
    if (!r.ok) return { ok: false, error: r.error };
    const saved = await setMemoAiReview(row.id, { evaluation: r.evaluation, suggestions: r.suggestions });
    if (!saved) return { ok: false, error: '保存失败' };
    setItems(prev =>
      prev.map(m =>
        m.id === row.id
          ? { ...m, ai_evaluation: r.evaluation, ai_suggestions: r.suggestions, ai_review_at: saved.ai_review_at }
          : m,
      ),
    );
    return { ok: true };
  }, []);

  const openAiModal = useCallback(
    (row: MemoItem) => {
      if (!zhipuReady) {
        Alert.alert('无法调用 AI', '请配置智谱 API 密钥（EXPO_PUBLIC_ZHIPU_API_KEY）。');
        return;
      }
      if (!memoContextForAiReview(row)) {
        Alert.alert('内容为空', '请先为该备忘填写标题或正文。');
        return;
      }
      setAiModalId(row.id);
    },
    [zhipuReady],
  );

  const onModalRegenerate = useCallback(async () => {
    if (!aiModalItem) return;
    setAiModalLoading(true);
    try {
      const res = await runAiForMemo(aiModalItem);
      if (!res.ok) Alert.alert('生成失败', res.error);
    } finally {
      setAiModalLoading(false);
    }
  }, [aiModalItem, runAiForMemo]);

  const togglePin = useCallback(async (row: MemoItem) => {
    const next = !row.is_pinned;
    try {
      const updated = await setMemoPinned(row.id, next);
      if (!updated) {
        Alert.alert('操作失败', '该备忘可能已删除');
        return;
      }
      setItems(prev => prev.map(m => (m.id === row.id ? { ...m, is_pinned: next || undefined } : m)));
    } catch {
      Alert.alert('操作失败', '请稍后重试');
    }
  }, []);

  const performConvertToTodo = useCallback(
    async (row: MemoItem) => {
      setConvertingMemoId(row.id);
      try {
        const { taskId, title } = await createStandaloneTodoFromMemo(row);
        setItems(prev => prev.filter(m => m.id !== row.id));
        delete swipeableRefs.current[row.id];
        setAiModalId(prevId => (prevId === row.id ? null : prevId));
        Alert.alert('已转为待办', `「${title}」已加入待办列表，原备忘已删除。`, [
          { text: '知道了', style: 'cancel' },
          { text: '查看待办', onPress: () => router.push({ pathname: '/task/[id]', params: { id: taskId } }) },
        ]);
      } catch {
        Alert.alert('转换失败', '请稍后重试');
      } finally {
        setConvertingMemoId(prev => (prev === row.id ? null : prev));
      }
    },
    [router],
  );

  const performConvertToProject = useCallback(
    async (row: MemoItem) => {
      setConvertingMemoId(row.id);
      try {
        const { projectId, name } = await createProjectFromMemoInInbox(row);
        setItems(prev => prev.filter(m => m.id !== row.id));
        delete swipeableRefs.current[row.id];
        setAiModalId(prevId => (prevId === row.id ? null : prevId));
        Alert.alert('已转为项目', `「${name}」已加入收集箱，原备忘已删除。`, [
          { text: '知道了', style: 'cancel' },
          {
            text: '查看项目',
            onPress: () => router.push({ pathname: '/edit-project', params: { id: projectId } }),
          },
        ]);
      } catch (e) {
        if (e instanceof Error && e.message === 'duplicate_name') {
          Alert.alert('转换失败', '已有同名项目，请修改备忘标题后再转换。');
        } else {
          Alert.alert('转换失败', '请稍后重试');
        }
      } finally {
        setConvertingMemoId(prev => (prev === row.id ? null : prev));
      }
    },
    [router],
  );

  const onDeleteMemo = useCallback((row: MemoItem) => {
    const title = memoListPreviewTitle(row);
    Alert.alert('删除备忘', `确定删除「${title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteMemo(row.id);
              setItems(prev => prev.filter(i => i.id !== row.id));
              setAiModalId(prevId => (prevId === row.id ? null : prevId));
            } catch {
              Alert.alert('删除失败', '请稍后重试');
            }
          })();
        },
      },
    ]);
  }, []);

  const openNewMemo = useCallback(() => {
    router.push({ pathname: '/memo-edit/[id]', params: { id: 'new' } });
  }, [router]);

  const openRowActions = useCallback(
    (row: MemoItem) => {
      Alert.alert(memoListPreviewTitle(row), undefined, [
        {
          text: row.is_pinned ? '取消置顶' : '置顶',
          onPress: () => void togglePin(row),
        },
        { text: 'AI 分析', onPress: () => openAiModal(row) },
        { text: '编辑', onPress: () => router.push({ pathname: '/memo-edit/[id]', params: { id: row.id } }) },
        { text: '删除', style: 'destructive', onPress: () => onDeleteMemo(row) },
        { text: '取消', style: 'cancel' },
      ]);
    },
    [onDeleteMemo, openAiModal, router, togglePin],
  );

  const renderListHeader = useMemo(
    () => (
      <View style={styles.toolbar}>
        <View style={[styles.searchWrap, { backgroundColor: searchBg, borderColor: line }]}>
          <MaterialIcons name="search" size={18} color={muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="搜索标题或正文"
            placeholderTextColor={muted}
            style={[styles.searchInput, { color: ink }]}
            returnKeyType="search"
          />
          {search ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <MaterialIcons name="close" size={18} color={muted} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            <Pressable
              onPress={() => setTagFilter(TAG_FILTER_ALL)}
              style={[
                styles.chip,
                {
                  borderColor: tagFilter === TAG_FILTER_ALL ? primary : line,
                  backgroundColor: tagFilter === TAG_FILTER_ALL ? `${primary}14` : chipBg,
                },
              ]}>
              <Text style={[styles.chipText, { color: tagFilter === TAG_FILTER_ALL ? primary : ink }]}>全部</Text>
            </Pressable>
            <Pressable
              onPress={() => setTagFilter(TAG_FILTER_NONE)}
              style={[
                styles.chip,
                {
                  borderColor: tagFilter === TAG_FILTER_NONE ? primary : line,
                  backgroundColor: tagFilter === TAG_FILTER_NONE ? `${primary}14` : chipBg,
                },
              ]}>
              <Text style={[styles.chipText, { color: tagFilter === TAG_FILTER_NONE ? primary : ink }]}>无标签</Text>
            </Pressable>
            {usedTags.map(tag => {
              const active = tagFilter === tag.id;
              return (
                <Pressable
                  key={tag.id}
                  onPress={() => setTagFilter(tag.id)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? tag.color : line,
                      backgroundColor: active ? `${tag.color}22` : chipBg,
                    },
                  ]}>
                  <View style={[styles.chipDot, { backgroundColor: tag.color }]} />
                  <Text style={[styles.chipText, { color: active ? tag.color : ink }]} numberOfLines={1}>
                    {tag.name}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => router.push('/project-tags')}
              style={[styles.chip, { borderColor: line, backgroundColor: chipBg }]}>
              <MaterialIcons name="local-offer" size={14} color={primary} />
              <Text style={[styles.chipText, { color: primary }]}>管理标签</Text>
            </Pressable>
          </ScrollView>

          <Pressable
            onPress={() => setSortMenuVisible(true)}
            style={[styles.sortBtn, { borderColor: line, backgroundColor: chipBg }]}>
            <MaterialIcons name="sort" size={18} color={primary} />
          </Pressable>
        </View>
      </View>
    ),
    [chipBg, ink, line, muted, primary, router, search, searchBg, tagFilter, usedTags],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: ListRow }) => {
      if (row.kind === 'section') {
        return (
          <View style={styles.sectionHead}>
            <Text style={[styles.sectionLabel, { color: muted }]}>{row.label}</Text>
          </View>
        );
      }

      const item = row.item;
      const isConverting = convertingMemoId === item.id;
      const tags = tagsByMemoId.get(item.id) ?? [];
      const iso = sortMode === 'created' ? item.created_at : item.updated_at;

      return (
        <Swipeable
          ref={r => {
            swipeableRefs.current[item.id] = r;
          }}
          overshootRight={false}
          rightThreshold={48}
          renderRightActions={() => (
            <View style={styles.swipeActionsRow}>
              <Pressable
                onPress={() => void togglePin(item)}
                style={({ pressed }) => [
                  styles.swipeAction,
                  { backgroundColor: colors.tertiary, opacity: pressed ? 0.9 : 1 },
                ]}>
                <MaterialIcons name="push-pin" size={20} color="#fff" />
                <Text style={styles.swipeActionText}>{item.is_pinned ? '取消' : '置顶'}</Text>
              </Pressable>
              <Pressable
                onPress={() => performConvertToTodo(item)}
                disabled={isConverting}
                style={({ pressed }) => [
                  styles.swipeAction,
                  { backgroundColor: primary, opacity: isConverting ? 0.55 : pressed ? 0.92 : 1 },
                ]}>
                {isConverting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialIcons name="playlist-add-check" size={20} color="#fff" />
                )}
                <Text style={styles.swipeActionText}>待办</Text>
              </Pressable>
              <Pressable
                onPress={() => performConvertToProject(item)}
                disabled={isConverting}
                style={({ pressed }) => [
                  styles.swipeAction,
                  { backgroundColor: secondary, opacity: isConverting ? 0.55 : pressed ? 0.92 : 1 },
                ]}>
                {isConverting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialIcons name="folder-special" size={20} color="#fff" />
                )}
                <Text style={styles.swipeActionText}>项目</Text>
              </Pressable>
              <Pressable
                onPress={() => onDeleteMemo(item)}
                style={({ pressed }) => [
                  styles.swipeAction,
                  { backgroundColor: danger, opacity: pressed ? 0.92 : 1 },
                ]}>
                <MaterialIcons name="delete-outline" size={20} color="#fff" />
                <Text style={styles.swipeActionText}>删除</Text>
              </Pressable>
            </View>
          )}>
          <View style={styles.noteOuter}>
            <View style={styles.timelineCol}>
              <View style={[styles.timelineDot, { backgroundColor: item.is_pinned ? colors.tertiary : primary }]} />
              <View style={[styles.timelineStem, { backgroundColor: line }]} />
            </View>
            <Pressable
              onPress={() => router.push({ pathname: '/memo-view/[id]', params: { id: item.id } })}
              onLongPress={() => openRowActions(item)}
              delayLongPress={360}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: colors.surface,
                  borderColor: line,
                  opacity: pressed ? 0.92 : 1,
                },
              ]}>
              <View style={styles.rowMain}>
                <View style={styles.rowTitleLine}>
                  {item.is_pinned ? (
                    <MaterialIcons name="push-pin" size={14} color={colors.tertiary} style={{ marginRight: 4 }} />
                  ) : null}
                  <Text style={[styles.rowTitle, { color: ink }]} numberOfLines={2}>
                    {memoListPreviewTitle(item)}
                  </Text>
                  <Text style={[styles.rowTime, { color: muted }]}>{timeShort(iso)}</Text>
                </View>
                <Text style={[styles.rowPreview, { color: muted }]} numberOfLines={2}>
                  {memoListPreviewBody(item)}
                </Text>
                {tags.length > 0 ? (
                  <View style={styles.tagDots}>
                    {tags.slice(0, 4).map(t => (
                      <View
                        key={t.id}
                        style={[styles.miniTag, { backgroundColor: `${t.color}22`, borderColor: `${t.color}44` }]}>
                        <Text style={[styles.miniTagText, { color: t.color }]} numberOfLines={1}>
                          {t.name}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {item.ai_evaluation ? (
                  <Text style={[styles.aiLine, { color: secondary }]} numberOfLines={1}>
                    AI · {item.ai_evaluation}
                  </Text>
                ) : pendingAnalysisIds.has(item.id) ? (
                  <View style={styles.aiPending}>
                    <ActivityIndicator size="small" color={primary} />
                    <Text style={[styles.aiLine, { color: muted }]}>AI 分析中…</Text>
                  </View>
                ) : null}
              </View>
              <Pressable hitSlop={10} onPress={() => openAiModal(item)} style={styles.aiBtn}>
                <MaterialIcons name="auto-awesome" size={18} color={primary} />
              </Pressable>
            </Pressable>
          </View>
        </Swipeable>
      );
    },
    [
      colors.surface,
      colors.tertiary,
      convertingMemoId,
      danger,
      ink,
      line,
      muted,
      onDeleteMemo,
      openAiModal,
      openRowActions,
      pendingAnalysisIds,
      performConvertToProject,
      performConvertToTodo,
      primary,
      router,
      secondary,
      sortMode,
      tagsByMemoId,
      togglePin,
    ],
  );

  const filteredEmpty = Boolean(search || tagFilter !== TAG_FILTER_ALL);

  return (
    <>
    <CrudListScreen
      title="备忘录"
      onBack={() => router.back()}
      headerRight={
        <AppIconButton icon="add" size={26} color={primary} onPress={openNewMemo} accessibilityLabel="新建备忘" />
      }
      loading={loading}
      loadingHint="加载备忘…"
      error={error}
      onRetryError={() => {
        resetSync();
        void reload(true);
      }}
      style={{ backgroundColor: paper }}>
      <FlatList
        data={listRows}
        keyExtractor={r => r.key}
        renderItem={renderRow}
        ListHeaderComponent={renderListHeader}
        refreshControl={refreshControl}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 28 },
          listRows.length === 0 ? styles.listEmptyPad : null,
        ]}
        ListEmptyComponent={
          <ScreenEmptyState
            icon="sticky-note-2"
            title={filteredEmpty ? '没有匹配的备忘' : '还没有备忘'}
            subtitle={filteredEmpty ? '试试换个关键词或标签' : '点右上角 + 写第一条笔记'}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </CrudListScreen>

      <Modal visible={sortMenuVisible} transparent animationType="fade" onRequestClose={() => setSortMenuVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSortMenuVisible(false)}>
          <Pressable
            onPress={() => {}}
            style={[styles.sortSheet, { backgroundColor: colors.surface, borderColor: line }]}>
            <Text style={[styles.sortTitle, { color: ink }]}>排序</Text>
            <Text style={[styles.sortHint, { color: muted }]}>置顶的备忘始终排在最前</Text>
            {SORT_OPTIONS.map(opt => {
              const active = sortMode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => {
                    setSortMode(opt.id);
                    setSortMenuVisible(false);
                  }}
                  style={styles.sortOption}>
                  <Text style={[styles.sortOptionText, { color: active ? primary : ink }]}>{opt.label}</Text>
                  {active ? <MaterialIcons name="check" size={20} color={primary} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!aiModalItem} transparent animationType="fade" onRequestClose={() => setAiModalId(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setAiModalId(null)}>
          <Pressable
            onPress={() => {}}
            style={[styles.aiSheet, { backgroundColor: colors.surface, borderColor: line }]}>
            <View style={styles.aiSheetHead}>
              <Text style={[styles.aiSheetTitle, { color: ink }]} numberOfLines={1}>
                AI · {aiModalItem ? memoListPreviewTitle(aiModalItem) : ''}
              </Text>
              <Pressable onPress={() => setAiModalId(null)} hitSlop={10}>
                <MaterialIcons name="close" size={22} color={muted} />
              </Pressable>
            </View>
            {aiModalLoading ? (
              <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
            ) : (
              <>
                <Text style={[styles.aiKicker, { color: muted }]}>评价</Text>
                <Text style={[styles.aiBody, { color: ink }]}>
                  {aiModalItem?.ai_evaluation?.trim() || '尚未生成'}
                </Text>
                <Text style={[styles.aiKicker, { color: muted, marginTop: 14 }]}>建议</Text>
                <Text style={[styles.aiBody, { color: secondary }]}>
                  {aiModalItem?.ai_suggestions?.trim() || '尚未生成'}
                </Text>
              </>
            )}
            <Pressable
              onPress={() => void onModalRegenerate()}
              disabled={aiModalLoading}
              style={({ pressed }) => [
                styles.regenBtn,
                { backgroundColor: primary, opacity: aiModalLoading || pressed ? 0.85 : 1 },
              ]}>
              <Text style={styles.regenText}>{aiModalItem?.ai_evaluation ? '重新生成' : '开始分析'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingTop: Spacing['3xl'], gap: Spacing['3xl'] },
  searchWrap: {
    marginHorizontal: Spacing['5xl'],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 42,
  },
  searchInput: { flex: 1, fontSize: 15, fontWeight: '500', paddingVertical: 8 },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: Spacing['5xl'],
    paddingRight: Spacing.md,
    gap: 8,
  },
  chipRow: { gap: 8, paddingRight: 4, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    maxWidth: 140,
  },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipText: { fontSize: 13, fontWeight: '600' },
  sortBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { flexGrow: 1 },
  listEmptyPad: { flexGrow: 1 },
  sectionHead: {
    paddingHorizontal: Spacing['5xl'],
    paddingTop: Spacing['5xl'],
    paddingBottom: Spacing.md,
  },
  sectionLabel: {
    ...Typography.label,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  noteOuter: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingLeft: Spacing['3xl'],
    paddingRight: Spacing['5xl'],
    paddingBottom: 10,
    gap: 10,
  },
  timelineCol: {
    width: 12,
    alignItems: 'center',
    paddingTop: 18,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineStem: {
    flex: 1,
    width: StyleSheet.hairlineWidth * 2,
    marginTop: 6,
    minHeight: 12,
    opacity: 0.7,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  rowMain: { flex: 1, gap: 6 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 2 },
  rowTitle: { flex: 1, fontSize: 16, fontWeight: '800', letterSpacing: -0.25, lineHeight: 22 },
  rowTime: { fontSize: 11, fontWeight: '600', marginLeft: 8, marginTop: 3 },
  rowPreview: { fontSize: 13, fontWeight: '500', lineHeight: 19, opacity: 0.92 },
  tagDots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  miniTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: 96,
  },
  miniTagText: { fontSize: 11, fontWeight: '700' },
  aiLine: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  aiPending: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  aiBtn: { paddingTop: 2, paddingLeft: 4 },
  swipeActionsRow: { flexDirection: 'row', alignItems: 'stretch' },
  swipeAction: {
    width: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swipeActionText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    padding: 24,
  },
  sortSheet: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 4,
  },
  sortTitle: { fontSize: 17, fontWeight: '800' },
  sortHint: { fontSize: 12, fontWeight: '500', marginBottom: 8 },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  sortOptionText: { fontSize: 15, fontWeight: '600' },
  aiSheet: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    maxHeight: '80%',
  },
  aiSheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  aiSheetTitle: { flex: 1, fontSize: 16, fontWeight: '800' },
  aiKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  aiBody: { fontSize: 14, fontWeight: '500', lineHeight: 22, marginTop: 4 },
  regenBtn: {
    marginTop: 18,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  regenText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
