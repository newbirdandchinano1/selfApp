import { CrudListScreen, ScreenEmptyState } from '@/components/crud';
import { MemoCenterSheet, useMemoCenterSheetClose } from '@/components/memo/memo-center-sheet';
import { MemoFilterDrawer } from '@/components/memo/memo-filter-drawer';
import { MemoListRow } from '@/components/memo/memo-list-row';
import { memoWallTone } from '@/components/memo/memo-wall';
import { MemoListSkeleton } from '@/components/memo/memo-list-skeleton';
import {
  useMemoListLayout,
  useResetMemoEnteredOnUnmount,
} from '@/components/memo/use-memo-list-motion';
import { AppButton, AppIconButton, MotionPressable } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { MemoRadius, MemoText } from '@/constants/memo-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import { createProjectFromMemoInInbox } from '@/lib/memo-to-project';
import { createStandaloneTodoFromMemo } from '@/lib/memo-to-task';
import {
  deleteMemo,
  listMemos,
  memoContextForAiReview,
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
import { analyzeMemoReviewFromText } from '@/lib/zhipu-image-parse';
import { plainTextFromBody } from '@/lib/memo-richdoc/plain-text';
import { getMemoTags, getTagsByEntityIds, normalizeTagDomain } from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { fetchProfileMemoList } from '@/lib/profile-page-api';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MEMO_LIST_PAGE_KEY = 'memo-list';
const TAG_FILTER_ALL = '__all__';
const TAG_FILTER_NONE = '__none__';
const SORT_OPTIONS: { id: MemoSortMode; label: string }[] = [
  { id: 'updated', label: '最近更新' },
  { id: 'created', label: '最近创建' },
  { id: 'title', label: '标题' },
];

type ListRow = { kind: 'board'; key: string; left: MemoItem[]; right: MemoItem[] };

/** 按正文长短估算便利贴高度，短的一列继续接下一张，形成瀑布流。 */
function estimateStickyHeight(item: MemoItem): number {
  const text = plainTextFromBody(item.body).trim();
  const lines = Math.min(6, Math.max(1, Math.ceil(Math.min(text.length, 140) / 16)));
  return 120 + lines * 20;
}

function splitStickyColumns(items: MemoItem[]): { left: MemoItem[]; right: MemoItem[] } {
  const left: MemoItem[] = [];
  const right: MemoItem[] = [];
  let leftHeight = 0;
  let rightHeight = 0;
  for (const item of items) {
    const height = estimateStickyHeight(item);
    if (leftHeight <= rightHeight) {
      left.push(item);
      leftHeight += height;
    } else {
      right.push(item);
      rightHeight += height;
    }
  }
  return { left, right };
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMasonryRows(items: MemoItem[], sortMode: MemoSortMode): ListRow[] {
  const sorted = sortMemos(items, sortMode);
  if (sorted.length === 0) return [];
  const { left, right } = splitStickyColumns(sorted);
  return [{ kind: 'board', key: 'board-all', left, right }];
}

/** 日期写在便利贴上，列表不再按天分组。 */
function timeInside(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const clock = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const ymd = dayKey(iso);
  if (ymd === 'unknown') return clock;
  const today = dayKey(now.toISOString());
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const yesterday = dayKey(yest.toISOString());
  if (ymd === today) return `今天 ${clock}`;
  if (ymd === yesterday) return `昨天 ${clock}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${clock}`;
}

export default function MemoListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useAppTheme();

  const wall = useMemo(() => memoWallTone(isDark), [isDark]);
  const ink = colors.text;
  const muted = colors.textSecondary;
  const line = colors.outline;
  const primary = colors.primary;
  const secondary = colors.secondary;

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
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [actionRow, setActionRow] = useState<MemoItem | null>(null);

  const listRef = useRef<FlatList<ListRow>>(null);
  const convertingLockRef = useRef<string | null>(null);
  const prevIdsRef = useRef<Set<string> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollYRef = useRef(0);
  const sortModeRef = useRef(sortMode);
  const searchRef = useRef(search);
  const tagFilterRef = useRef(tagFilter);
  sortModeRef.current = sortMode;
  searchRef.current = search;
  tagFilterRef.current = tagFilter;
  /** 本页生命周期内，每个标签只展开一次。离开页面后由卸载清理。 */
  const playedTagFiltersRef = useRef<Set<string>>(new Set());
  const [expandToken, setExpandToken] = useState(0);
  const { wrapLoad, resetSync } = usePageApiSync(MEMO_LIST_PAGE_KEY);
  const { withLayout } = useMemoListLayout();

  useResetMemoEnteredOnUnmount();

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

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const armHighlight = useCallback((id: string) => {
    setHighlightId(id);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightId(current => (current === id ? null : current));
    }, 600);
  }, []);

  /** 新笔记排进当前列表前 3 条、且用户不在顶部时，才滚回去看高亮。 */
  const scrollToNewMemoIfNeeded = useCallback((memos: MemoItem[], freshId: string, tags: Map<string, TagRow[]>) => {
    let pool = memos.filter(m => memoMatchesSearch(m, searchRef.current));
    const filter = tagFilterRef.current;
    if (filter === TAG_FILTER_NONE) {
      pool = pool.filter(m => !(tags.get(m.id)?.length));
    } else if (filter !== TAG_FILTER_ALL) {
      pool = pool.filter(m => (tags.get(m.id) ?? []).some(t => t.id === filter));
    }
    const sorted = sortMemos(pool, sortModeRef.current);
    const rank = sorted.findIndex(m => m.id === freshId);
    if (rank < 0 || rank >= 3) return;
    if (scrollYRef.current <= 48) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
  }, []);

  const reload = useCallback(
    async (forceRefresh = false) => {
      setError(null);
      try {
        await wrapLoad(async () => {
          await fetchProfileMemoList({ serverFallback: true });
          const [memos, tags] = await Promise.all([listMemos(), getMemoTags()]);
          const prevIds = prevIdsRef.current;
          prevIdsRef.current = new Set(memos.map(m => m.id));
          setItems(memos);
          setAllTags(tags);
          const map = await getTagsByEntityIds(
            'memo',
            memos.map(m => m.id),
          );
          setTagsByMemoId(map);

          // 首次加载没有「上一份」，不高亮全部。高亮 id 独立于这次 setItems。
          if (prevIds) {
            const fresh = memos.find(m => !prevIds.has(m.id));
            if (fresh) {
              armHighlight(fresh.id);
              scrollToNewMemoIfNeeded(memos, fresh.id, map);
            } else {
              setHighlightId(current => {
                if (current && !memos.some(m => m.id === current)) {
                  if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
                  return null;
                }
                return current;
              });
            }
          }
        }, forceRefresh);
      } catch {
        setError('加载失败，请重试');
        setItems([]);
        setAllTags([]);
        setTagsByMemoId(new Map());
      } finally {
        setLoading(false);
      }
    },
    [armHighlight, scrollToNewMemoIfNeeded, wrapLoad],
  );

  const { refreshing, onRefresh } = usePagePullRefresh(MEMO_LIST_PAGE_KEY, reload);
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
    () => buildMasonryRows(filteredItems, sortMode),
    [filteredItems, sortMode],
  );

  // 首次打开，或第一次切到某个还没展开过的标签，且当前有便利贴时播一轮展开。
  // 放在 effect 里，避免渲染期间 setState 把页面打成死循环。
  useEffect(() => {
    if (loading || filteredItems.length === 0) return;
    if (playedTagFiltersRef.current.has(tagFilter)) return;
    playedTagFiltersRef.current.add(tagFilter);
    setExpandToken(token => token + 1);
  }, [filteredItems.length, loading, tagFilter]);

  const usedTags = useMemo(() => {
    const byId = new Map<string, TagRow>();
    // 筛选芯片只用备忘录域标签，不混入任务侧标签
    for (const t of allTags) byId.set(t.id, t);
    for (const list of tagsByMemoId.values()) {
      for (const t of list) {
        if (normalizeTagDomain(t.domain) === 'memo') byId.set(t.id, t);
      }
    }
    return [...byId.values()].sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
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
    const r = await analyzeMemoReviewFromText({ memoContextText: ctx });
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
      if (!memoContextForAiReview(row)) {
        Alert.alert('内容为空', '请先为该备忘填写标题或正文。');
        return;
      }
      setAiModalId(row.id);
    },
    [],
  );

  const aiRunLock = useRef(false);
  const onModalRegenerate = useCallback(async () => {
    if (!aiModalItem || aiModalLoading || aiRunLock.current) return;
    aiRunLock.current = true;
    setAiModalLoading(true);
    try {
      const res = await runAiForMemo(aiModalItem);
      if (!res.ok) toast.error(res.error);
    } finally {
      aiRunLock.current = false;
      setAiModalLoading(false);
    }
  }, [aiModalItem, aiModalLoading, runAiForMemo]);

  const togglePin = useCallback(async (row: MemoItem) => {
    const next = !row.is_pinned;
    try {
      const updated = await setMemoPinned(row.id, next);
      if (!updated) {
        toast.error('该备忘可能已删除');
        return;
      }
      withLayout(() => {
        setItems(prev => prev.map(m => (m.id === updated.id ? updated : m)));
      });
    } catch (e) {
      toast.error(toUserMessage(e, '操作失败，请稍后重试'));
    }
  }, [withLayout]);

  const performConvertToTodo = useCallback(
    async (row: MemoItem) => {
      if (convertingLockRef.current) return;
      convertingLockRef.current = row.id;
      setConvertingMemoId(row.id);
      try {
        const { taskId, title } = await createStandaloneTodoFromMemo(row);
        withLayout(() => {
          setItems(prev => prev.filter(m => m.id !== row.id));
        });
        setHighlightId(current => (current === row.id ? null : current));
        setAiModalId(prevId => (prevId === row.id ? null : prevId));
        Alert.alert('已转为待办', `「${title}」已加入待办列表，原备忘已删除。`, [
          { text: '知道了', style: 'cancel' },
          { text: '查看待办', onPress: () => router.push({ pathname: '/task/[id]', params: { id: taskId } }) },
        ]);
      } catch (e) {
        toast.error(toUserMessage(e, '转换失败，请稍后重试'));
      } finally {
        if (convertingLockRef.current === row.id) convertingLockRef.current = null;
        setConvertingMemoId(prev => (prev === row.id ? null : prev));
      }
    },
    [router, withLayout],
  );

  const performConvertToProject = useCallback(
    async (row: MemoItem) => {
      if (convertingLockRef.current) return;
      convertingLockRef.current = row.id;
      setConvertingMemoId(row.id);
      try {
        const { projectId, name } = await createProjectFromMemoInInbox(row);
        withLayout(() => {
          setItems(prev => prev.filter(m => m.id !== row.id));
        });
        setHighlightId(current => (current === row.id ? null : current));
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
          toast.warn('已有同名项目，请修改备忘标题后再转换。');
        } else {
          toast.error(toUserMessage(e, '转换失败，请稍后重试'));
        }
      } finally {
        if (convertingLockRef.current === row.id) convertingLockRef.current = null;
        setConvertingMemoId(prev => (prev === row.id ? null : prev));
      }
    },
    [router, withLayout],
  );

  const onDeleteMemo = useCallback((row: MemoItem) => {
    const title = memoListPreviewTitle(row);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    Alert.alert('删除备忘', `确定删除「${title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteMemo(row.id);
              withLayout(() => {
                setItems(prev => prev.filter(i => i.id !== row.id));
              });
              setHighlightId(current => (current === row.id ? null : current));
              setAiModalId(prevId => (prevId === row.id ? null : prevId));
              toast.success('已删除');
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败，请稍后重试'));
            }
          })();
        },
      },
    ]);
  }, [withLayout]);

  const openNewMemo = useCallback(() => {
    router.push({ pathname: '/memo-edit/[id]', params: { id: 'new' } });
  }, [router]);

  const openRowActions = useCallback((row: MemoItem) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setActionRow(row);
  }, []);

  const openRow = useCallback(
    (row: MemoItem) => {
      router.push({ pathname: '/memo-view/[id]', params: { id: row.id } });
    },
    [router],
  );

  const applyTagFilter = useCallback(
    (next: string) => {
      withLayout(() => setTagFilter(next));
    },
    [withLayout],
  );

  const applySortMode = useCallback(
    (next: MemoSortMode) => {
      withLayout(() => setSortMode(next));
    },
    [withLayout],
  );

  const renderRow = useCallback(
    ({ item: row }: ListRenderItemInfo<ListRow>) => {
      const renderSticky = (item: MemoItem, staggerIndex: number) => {
        const isConverting = convertingMemoId === item.id;
        const tags = tagsByMemoId.get(item.id) ?? [];
        const iso = sortMode === 'created' ? item.created_at : item.updated_at;
        return (
          <MemoListRow
            key={item.id}
            item={item}
            tags={tags}
            timeLabel={timeInside(iso)}
            expandToken={expandToken}
            staggerIndex={staggerIndex}
            highlighted={highlightId === item.id}
            converting={isConverting}
            aiPending={pendingAnalysisIds.has(item.id)}
            onPress={openRow}
            onLongPress={openRowActions}
            onAiPress={openAiModal}
          />
        );
      };

      return (
        <View style={styles.board}>
          <View style={styles.column}>{row.left.map((item, index) => renderSticky(item, index * 2))}</View>
          <View style={styles.column}>{row.right.map((item, index) => renderSticky(item, index * 2 + 1))}</View>
        </View>
      );
    },
    [
      convertingMemoId,
      expandToken,
      highlightId,
      openAiModal,
      openRow,
      openRowActions,
      pendingAnalysisIds,
      sortMode,
      tagsByMemoId,
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
      loadingSkeleton={<MemoListSkeleton />}
      error={error}
      onRetryError={() => {
        resetSync();
        void reload(true);
      }}
      immediate
      headerProps={{ style: styles.wallHeader }}
      style={{ backgroundColor: wall.base }}>
      <MemoFilterDrawer
        search={search}
        onSearchChange={setSearch}
        tagFilter={tagFilter}
        filterAll={TAG_FILTER_ALL}
        filterNone={TAG_FILTER_NONE}
        onTagFilter={applyTagFilter}
        usedTags={usedTags}
        onManageTags={() => router.push({ pathname: '/project-tags', params: { domain: 'memo' } })}
        onSort={() => setSortMenuVisible(true)}
        refreshing={refreshing}
        onRefresh={() => {
          void onRefresh();
        }}
        paper={wall.drawerPaper}
        cavity={wall.drawerCavity}
        searchBg={wall.searchBg}
        chipBg={wall.chipBg}
        ink={wall.ink}
        muted={wall.muted}
        line={wall.line}
        primary={primary}
        renderList={({ scrollEnabled, onScroll }) => (
      <FlatList
        ref={listRef}
        data={listRows}
        style={styles.list}
        keyExtractor={r => r.key}
        renderItem={renderRow}
        scrollEnabled={scrollEnabled}
        bounces={false}
        overScrollMode="never"
        // 便利贴有旋转与绝对定位装饰，Android 默认裁剪会把整卡裁没
        removeClippedSubviews={false}
        onScroll={event => {
          const offsetY = event.nativeEvent.contentOffset.y;
          scrollYRef.current = offsetY;
          onScroll(offsetY);
        }}
        scrollEventThrottle={16}
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
            actionLabel={filteredEmpty ? undefined : '写一条'}
            onAction={filteredEmpty ? undefined : openNewMemo}
          />
        }
        showsVerticalScrollIndicator={false}
      />
        )}
      />
    </CrudListScreen>

      <MemoCenterSheet
        visible={!!actionRow}
        onClose={() => setActionRow(null)}
        style={[styles.sortSheet, { backgroundColor: colors.surface, borderColor: line }]}>
        {actionRow ? (
          <RowActionSheet
            row={actionRow}
            ink={ink}
            danger={colors.danger}
            onPin={() => void togglePin(actionRow)}
            onAi={() => openAiModal(actionRow)}
            onEdit={() => router.push({ pathname: '/memo-edit/[id]', params: { id: actionRow.id } })}
            onTodo={() => void performConvertToTodo(actionRow)}
            onProject={() => void performConvertToProject(actionRow)}
            onDelete={() => onDeleteMemo(actionRow)}
          />
        ) : null}
      </MemoCenterSheet>

      <MemoCenterSheet
        visible={sortMenuVisible}
        onClose={() => setSortMenuVisible(false)}
        style={[styles.sortSheet, { backgroundColor: colors.surface, borderColor: line }]}>
        <SortSheetBody
          ink={ink}
          muted={muted}
          primary={primary}
          sortMode={sortMode}
          onPick={applySortMode}
        />
      </MemoCenterSheet>

      <MemoCenterSheet
        visible={!!aiModalItem}
        onClose={() => setAiModalId(null)}
        style={[styles.aiSheet, { backgroundColor: colors.surface, borderColor: line }]}>
        {aiModalItem ? (
          <AiSheetBody
            item={aiModalItem}
            ink={ink}
            muted={muted}
            secondary={secondary}
            loading={aiModalLoading}
            onRegenerate={() => void onModalRegenerate()}
          />
        ) : null}
      </MemoCenterSheet>
    </>
  );
}

function RowActionSheet({
  row,
  ink,
  danger,
  onPin,
  onAi,
  onEdit,
  onTodo,
  onProject,
  onDelete,
}: {
  row: MemoItem;
  ink: string;
  danger: string;
  onPin: () => void;
  onAi: () => void;
  onEdit: () => void;
  onTodo: () => void;
  onProject: () => void;
  onDelete: () => void;
}) {
  const requestClose = useMemoCenterSheetClose();
  const run = (action: () => void) => {
    if (!requestClose()) return;
    action();
  };
  const options: { key: string; label: string; color?: string; action: () => void }[] = [
    { key: 'pin', label: row.is_pinned ? '取消置顶' : '置顶', action: onPin },
    { key: 'ai', label: 'AI 分析', action: onAi },
    { key: 'edit', label: '编辑', action: onEdit },
    { key: 'todo', label: '转为待办', action: onTodo },
    { key: 'project', label: '转为项目', action: onProject },
    { key: 'delete', label: '删除', color: danger, action: onDelete },
  ];
  return (
    <>
      <Text style={[styles.sortTitle, { color: ink }]} numberOfLines={2}>
        {memoListPreviewTitle(row)}
      </Text>
      {options.map(opt => (
        <MotionPressable key={opt.key} onPress={() => run(opt.action)} style={styles.sortOption}>
          <Text style={[styles.sortOptionText, { color: opt.color ?? ink }]}>{opt.label}</Text>
        </MotionPressable>
      ))}
      <MotionPressable onPress={() => requestClose()} style={styles.sortOption}>
        <Text style={[styles.sortOptionText, { color: ink }]}>取消</Text>
      </MotionPressable>
    </>
  );
}

function SortSheetBody({
  ink,
  muted,
  primary,
  sortMode,
  onPick,
}: {
  ink: string;
  muted: string;
  primary: string;
  sortMode: MemoSortMode;
  onPick: (mode: MemoSortMode) => void;
}) {
  const requestClose = useMemoCenterSheetClose();
  return (
    <>
      <Text style={[styles.sortTitle, { color: ink }]}>排序</Text>
      <Text style={[styles.sortHint, { color: muted }]}>置顶的备忘始终排在最前</Text>
      {SORT_OPTIONS.map(opt => {
        const active = sortMode === opt.id;
        return (
          <MotionPressable
            key={opt.id}
            onPress={() => {
              if (!requestClose()) return;
              onPick(opt.id);
            }}
            style={styles.sortOption}>
            <Text style={[styles.sortOptionText, { color: active ? primary : ink }]}>{opt.label}</Text>
            {active ? <MaterialIcons name="check" size={20} color={primary} /> : null}
          </MotionPressable>
        );
      })}
    </>
  );
}

function AiSheetBody({
  item,
  ink,
  muted,
  secondary,
  loading,
  onRegenerate,
}: {
  item: MemoItem;
  ink: string;
  muted: string;
  secondary: string;
  loading: boolean;
  onRegenerate: () => void;
}) {
  const requestClose = useMemoCenterSheetClose();
  const evaluation = item.ai_evaluation?.trim() || '';
  const suggestions = item.ai_suggestions?.trim() || '';
  return (
    <>
      <View style={styles.aiSheetHead}>
        <Text style={[styles.aiSheetTitle, { color: ink }]} numberOfLines={1}>
          AI · {memoListPreviewTitle(item)}
        </Text>
        <MotionPressable
          onPress={() => {
            requestClose();
          }}
          hitSlop={10}
          accessibilityLabel="关闭">
          <MaterialIcons name="close" size={22} color={muted} />
        </MotionPressable>
      </View>
      <Text style={[styles.aiKicker, { color: muted }]}>评价</Text>
      <Text style={[styles.aiBody, { color: ink }]}>{evaluation || '尚未生成'}</Text>
      <Text style={[styles.aiKicker, { color: muted, marginTop: 14 }]}>建议</Text>
      <Text style={[styles.aiBody, { color: secondary }]}>{suggestions || '尚未生成'}</Text>
      <AppButton
        label={evaluation ? '重新生成' : '开始分析'}
        loading={loading}
        disabled={loading}
        onPress={onRegenerate}
        style={styles.regenBtn}
      />
    </>
  );
}

const styles = StyleSheet.create({
  wallHeader: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  list: { flex: 1, backgroundColor: 'transparent' },
  listContent: { flexGrow: 1 },
  listEmptyPad: { flexGrow: 1 },
  board: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  column: {
    flex: 1,
    paddingTop: Spacing.sm,
  },
  sortSheet: {
    borderRadius: MemoRadius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sortTitle: MemoText.sheetTitle,
  sortHint: { ...MemoText.caption, marginBottom: 8 },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  sortOptionText: MemoText.sheetOption,
  aiSheet: {
    borderRadius: MemoRadius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
    maxHeight: '80%',
  },
  aiSheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  aiSheetTitle: { flex: 1, ...MemoText.listTitle },
  aiKicker: MemoText.kicker,
  aiBody: { ...MemoText.aiBody, marginTop: 4 },
  regenBtn: { marginTop: 18 },
});
