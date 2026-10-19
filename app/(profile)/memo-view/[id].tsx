import { CrudDetailScreen } from '@/components/crud';
import { MemoFormattedBody } from '@/components/memo/memo-formatted-body';
import { MEMO_INK, MEMO_INK_SOFT, MEMO_WASH, MemoPaperPage } from '@/components/memo/memo-paper';
import { memoWallTone } from '@/components/memo/memo-wall';
import { AppIconButton } from '@/components/ui';
import { MemoRadius, MemoText, memoTagStyle } from '@/constants/memo-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { memoHasAiReview } from '@/lib/memo-format';
import {
  getMemo,
  memoListPreviewTitle,
  setMemoPinned,
  type MemoItem,
} from '@/lib/memos';
import { getTagsByEntity } from '@/lib/repositories/tags/tag';
import type { TagRow } from '@/lib/repositories/tags/tag.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

const PAGE_API_KEY = 'memo-view';

export default function MemoViewScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = normalizeId(idParam);
  const { isDark } = useAppTheme();
  const { height: windowHeight } = useWindowDimensions();
  const wall = useMemo(() => memoWallTone(isDark), [isDark]);
  const [viewportHeight, setViewportHeight] = useState(0);
  const pageMinHeight = Math.max(360, (viewportHeight || windowHeight - insets.top - 96) - 36);

  const [row, setRow] = useState<MemoItem | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackedId, setTrackedId] = useState(id);
  const rowRef = useRef(row);
  rowRef.current = row;
  const motion = useReducedMotionState();
  const aiOpacity = useRef(new Animated.Value(0)).current;
  const hadAiRef = useRef(false);

  if (trackedId !== id) {
    setTrackedId(id);
    setRow(null);
    setTags([]);
    setError(null);
    setLoading(true);
  }

  const reload = useCallback(
    async (forceRefresh = false) => {
      if (!id) {
        setLoading(false);
        return;
      }
      setError(null);
      try {
        await wrapLoad(async () => {
          const item = await getMemo(id);
          if (!item) {
            setRow(null);
            setTags([]);
            return;
          }
          setRow(item);
          setTags(await getTagsByEntity('memo', id));
        }, forceRefresh);
      } catch {
        setError('加载失败，请重试');
        setRow(null);
        setTags([]);
      } finally {
        setLoading(false);
      }
    },
    [id, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      const current = rowRef.current;
      if (!(current && current.id === id)) {
        setLoading(true);
      }
      void reload();
    }, [id, reload]),
  );

  const displayTitle = row ? memoListPreviewTitle(row) : '';
  const showAi = row ? memoHasAiReview(row) : false;

  useLayoutEffect(() => {
    if (!showAi) {
      hadAiRef.current = false;
      aiOpacity.setValue(0);
      return;
    }
    if (loading) return;
    if (hadAiRef.current) {
      aiOpacity.setValue(1);
      return;
    }
    hadAiRef.current = true;
    if (!motion.ready || motion.enabled) {
      aiOpacity.setValue(1);
      return;
    }
    aiOpacity.setValue(0);
    const anim = Animated.timing(aiOpacity, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [aiOpacity, loading, motion.enabled, motion.ready, showAi]);

  const onTogglePin = useCallback(async () => {
    if (!row || pinning) return;
    setPinning(true);
    try {
      const next = !row.is_pinned;
      const updated = await setMemoPinned(row.id, next);
      if (!updated) {
        toast.error('该备忘可能已删除');
        return;
      }
      setRow({ ...row, is_pinned: next || undefined });
    } catch (e) {
      toast.error(toUserMessage(e, '操作失败，请稍后重试'));
    } finally {
      setPinning(false);
    }
  }, [pinning, row]);

  if (!id) {
    return (
      <CrudDetailScreen title="备忘" onBack={() => router.back()} missing missingMessage="缺少备忘 ID" />
    );
  }

  return (
    <CrudDetailScreen
      title="备忘"
      onBack={() => router.back()}
      headerProps={{ style: styles.wallHeader }}
      headerRight={
        <View style={styles.headerActions}>
          <AppIconButton
            icon="push-pin"
            onPress={() => void onTogglePin()}
            disabled={!row || pinning}
            color={row?.is_pinned ? '#C4453A' : wall.ink}
            accessibilityLabel={row?.is_pinned ? '取消置顶' : '置顶'}
          />
          <AppIconButton
            icon="edit"
            onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id } })}
            disabled={!row}
            color={wall.ink}
            accessibilityLabel="编辑"
          />
        </View>
      }
      loading={loading}
      loadingHint="加载备忘…"
      error={error}
      onRetryError={() => {
        setLoading(true);
        void reload(true);
      }}
      missing={!loading && !error && !row}
      missingMessage="未找到该备忘"
      style={{ backgroundColor: wall.base }}>
      {row ? (
        <ScrollView
          refreshControl={refreshControl}
          onLayout={event => {
            const next = Math.ceil(event.nativeEvent.layout.height);
            setViewportHeight(prev => (prev === next ? prev : next));
          }}
          contentContainerStyle={[
            styles.scrollInner,
            { paddingBottom: Math.max(insets.bottom, 16) + 28 },
          ]}
          showsVerticalScrollIndicator={false}>
          <MemoPaperPage memoId={row.id} pinned={Boolean(row.is_pinned)} minHeight={pageMinHeight}>
            <Text style={styles.title}>{displayTitle}</Text>
            <Text style={styles.meta}>更新于 {new Date(row.updated_at).toLocaleString('zh-CN')}</Text>
            {row.created_at !== row.updated_at || row.is_pinned ? (
              <Text style={styles.metaSecond}>
                {[
                  row.created_at !== row.updated_at
                    ? `创建于 ${new Date(row.created_at).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                      })}`
                    : '',
                  row.is_pinned ? '已置顶' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            ) : null}

            {tags.length > 0 ? (
              <View style={styles.tagRow}>
                {tags.map(t => {
                  const tagStyle = memoTagStyle(t.color, false);
                  return (
                    <View key={t.id} style={styles.tagChip}>
                      <View style={[styles.tagDot, { backgroundColor: tagStyle.color }]} />
                      <Text style={styles.tagText}>{t.name}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.bodyBlock}>
              <MemoFormattedBody
                body={row.body}
                color={MEMO_INK}
                mutedColor={MEMO_INK_SOFT}
                quoteBg={MEMO_WASH}
              />
            </View>

            {showAi ? (
              <Animated.View style={[styles.aiBlock, { opacity: aiOpacity }]}>
                <View style={styles.aiHeader}>
                  <MaterialIcons name="auto-awesome" size={18} color={MEMO_INK_SOFT} />
                  <Text style={styles.aiTitle}>AI 评价与建议</Text>
                </View>
                <Text style={styles.aiKicker}>评价</Text>
                <Text style={styles.aiText}>{row.ai_evaluation?.trim() || '（暂无评价内容）'}</Text>
                <Text style={[styles.aiKicker, styles.aiSection]}>建议</Text>
                <Text style={styles.aiSuggest}>{row.ai_suggestions?.trim() || '（暂无建议内容）'}</Text>
                {row.ai_review_at ? (
                  <Text style={styles.aiTime}>生成于 {new Date(row.ai_review_at).toLocaleString('zh-CN')}</Text>
                ) : null}
              </Animated.View>
            ) : null}
          </MemoPaperPage>
        </ScrollView>
      ) : null}
    </CrudDetailScreen>
  );
}

const styles = StyleSheet.create({
  wallHeader: {
    backgroundColor: 'transparent',
    borderBottomWidth: 0,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  scrollInner: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  title: { ...MemoText.detailTitle, color: MEMO_INK },
  meta: {
    ...MemoText.caption,
    color: MEMO_INK_SOFT,
    marginTop: 8,
  },
  metaSecond: {
    ...MemoText.caption,
    color: MEMO_INK_SOFT,
    marginTop: 2,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: MEMO_WASH,
    borderRadius: MemoRadius.tag,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minHeight: 22,
  },
  tagDot: { width: 6, height: 6, borderRadius: 3 },
  tagText: { ...MemoText.tag, color: MEMO_INK, fontWeight: '600' },
  bodyBlock: {
    marginTop: 18,
    minHeight: 120,
  },
  aiBlock: {
    marginTop: 28,
    paddingTop: 16,
    paddingRight: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(58,42,26,0.2)',
  },
  aiSection: { marginTop: 12 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  aiTitle: { ...MemoText.listTitle, color: MEMO_INK },
  aiKicker: { ...MemoText.kicker, color: MEMO_INK_SOFT },
  aiText: { ...MemoText.aiBody, color: MEMO_INK, marginTop: 4 },
  aiSuggest: { ...MemoText.aiBody, color: MEMO_INK_SOFT, marginTop: 4 },
  aiTime: { ...MemoText.time, color: MEMO_INK_SOFT, marginTop: 12 },
});
