import { CrudDetailScreen } from '@/components/crud';
import { MemoFormattedBody } from '@/components/memo/memo-formatted-body';
import { AppIconButton } from '@/components/ui';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
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
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  const { colors, isDark } = useAppTheme();

  const paper = colors.background;
  const ink = colors.text;
  const muted = colors.textSecondary;
  const line = isDark ? 'rgba(148,163,184,0.22)' : colors.outlineStrong;
  const primary = colors.primary;
  const secondary = colors.secondary;
  const quoteBg = isDark ? colors.surfaceMuted : colors.primaryMuted;

  const [row, setRow] = useState<MemoItem | null>(null);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (forceApi = false) => {
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
        }, forceApi);
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
      setLoading(true);
      void reload();
    }, [reload]),
  );

  const displayTitle = row ? memoListPreviewTitle(row) : '';
  const showAi = row ? memoHasAiReview(row) : false;

  const onTogglePin = useCallback(async () => {
    if (!row || pinning) return;
    setPinning(true);
    try {
      const next = !row.is_pinned;
      const updated = await setMemoPinned(row.id, next);
      if (!updated) {
        Alert.alert('操作失败', '该备忘可能已删除');
        return;
      }
      setRow({ ...row, is_pinned: next || undefined });
    } catch {
      Alert.alert('操作失败', '请稍后重试');
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
      headerRight={
        <View style={styles.headerActions}>
          <AppIconButton
            icon="push-pin"
            onPress={() => void onTogglePin()}
            disabled={!row || pinning}
            color={row?.is_pinned ? colors.tertiary : muted}
            accessibilityLabel={row?.is_pinned ? '取消置顶' : '置顶'}
          />
          <AppIconButton
            icon="edit"
            onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id } })}
            disabled={!row}
            color={primary}
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
      style={{ backgroundColor: paper }}>
      {row ? (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scrollInner,
            { paddingBottom: Math.max(insets.bottom, 20) + 32 },
          ]}
          showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: ink }]}>{displayTitle}</Text>
          <Text style={[styles.meta, { color: muted }]}>
            更新于 {new Date(row.updated_at).toLocaleString('zh-CN')}
            {row.created_at !== row.updated_at
              ? ` · 创建于 ${new Date(row.created_at).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                })}`
              : ''}
            {row.is_pinned ? ' · 已置顶' : ''}
          </Text>

          {tags.length > 0 ? (
            <View style={styles.tagRow}>
              {tags.map(t => (
                <View
                  key={t.id}
                  style={[styles.tagChip, { backgroundColor: `${t.color}22`, borderColor: `${t.color}55` }]}>
                  <View style={[styles.tagDot, { backgroundColor: t.color }]} />
                  <Text style={[styles.tagText, { color: t.color }]}>{t.name}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.bodyBlock, { borderTopColor: line }]}>
            <MemoFormattedBody body={row.body} color={ink} mutedColor={muted} quoteBg={quoteBg} />
          </View>

          {showAi ? (
            <View style={[styles.aiBlock, { borderTopColor: line }]}>
              <View style={styles.aiHeader}>
                <MaterialIcons name="auto-awesome" size={18} color={primary} />
                <Text style={[styles.aiTitle, { color: ink }]}>AI 评价与建议</Text>
              </View>
              <Text style={[styles.aiKicker, { color: muted }]}>评价</Text>
              <Text style={[styles.aiText, { color: ink }]}>
                {row.ai_evaluation?.trim() || '（暂无评价内容）'}
              </Text>
              <Text style={[styles.aiKicker, { color: muted, marginTop: 16 }]}>建议</Text>
              <Text style={[styles.aiText, { color: secondary }]}>
                {row.ai_suggestions?.trim() || '（暂无建议内容）'}
              </Text>
              {row.ai_review_at ? (
                <Text style={[styles.aiTime, { color: muted }]}>
                  生成于 {new Date(row.ai_review_at).toLocaleString('zh-CN')}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </CrudDetailScreen>
  );
}

const styles = StyleSheet.create({
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  scrollInner: { paddingHorizontal: Spacing['5xl'], paddingTop: Spacing['5xl'] },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  meta: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  tagDot: { width: 7, height: 7, borderRadius: 4 },
  tagText: { fontSize: 12, fontWeight: '700' },
  bodyBlock: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 120,
  },
  aiBlock: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  aiTitle: { fontSize: 15, fontWeight: '800' },
  aiKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  aiText: { marginTop: 4, fontSize: 14, fontWeight: '500', lineHeight: 22 },
  aiTime: { marginTop: 12, fontSize: 11, fontWeight: '600' },
});
