/**
 * 消息 · 资讯：远端采集列表，封面色块、已读态、下拉刷新。
 * 对齐设计稿 08。
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon, ScreenEmptyState, type AppIconName } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import {
  fetchRemoteInboxPage,
  markAllRemoteInboxRead,
  markRemoteInboxRead,
  type RemoteInboxItem,
} from '@/lib/api/remote-inbox';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export type MessagesFeedPanelHandle = {
  markAllRead: () => void;
};

type Props = {
  onStatsChange?: (stats: { total: number; unread: number }) => void;
};

const COVER_PALETTES: { bg: [string, string]; fg: string; icon: AppIconName }[] = [
  { bg: ['#CBDCCB', '#8FB49F'], fg: '#22483B', icon: 'spa' },
  { bg: ['#F0DFC2', '#D9A45E'], fg: '#7A4E12', icon: 'whatshot' },
  { bg: ['#D6DEE8', '#8FA3B8'], fg: '#2F4557', icon: 'menu-book' },
  { bg: ['#E4D5CE', '#C08E77'], fg: '#6B3A26', icon: 'favorite-border' },
];

function coverFor(id: string, index: number) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COVER_PALETTES[(hash + index) % COVER_PALETTES.length]!;
}

function formatMeta(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins < 1 ? '刚刚' : `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  try {
    return new Date(t).toLocaleDateString();
  } catch {
    return '';
  }
}

function estimateMinutes(body: string): number {
  const len = body.trim().length;
  return Math.max(3, Math.min(12, Math.round(len / 80) || 4));
}

export const MessagesFeedPanel = forwardRef<MessagesFeedPanelHandle, Props>(
  function MessagesFeedPanel({ onStatsChange }, ref) {
    const { fold } = useFoldTheme();
    const { animate: motionOn } = useFoldMotionGate();
    const [items, setItems] = useState<RemoteInboxItem[]>([]);

    const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

    useEffect(() => {
      onStatsChange?.({ total: items.length, unread: unreadCount });
    }, [items.length, onStatsChange, unreadCount]);

    const reload = useCallback(async () => {
      try {
        const page = await fetchRemoteInboxPage();
        setItems(Array.isArray(page?.items) ? page.items : []);
      } catch (e) {
        if (__DEV__) console.warn('[messages/feed] fetch failed', e);
        setItems([]);
      }
    }, []);

    useEffect(() => {
      void reload();
    }, [reload]);

    const { refreshControl } = usePullToRefresh(reload);

    const doMarkAllRead = useCallback(() => {
      if (unreadCount === 0) return;
      const now = new Date().toISOString();
      setItems((prev) => prev.map((i) => (i.readAt ? i : { ...i, readAt: now })));
      void markAllRemoteInboxRead().catch((e) => {
        if (__DEV__) console.warn('[messages/feed] mark-all failed', e);
      });
    }, [unreadCount]);

    useImperativeHandle(ref, () => ({ markAllRead: doMarkAllRead }), [doMarkAllRead]);

    const onPressItem = useCallback((item: RemoteInboxItem) => {
      if (!item.readAt) {
        const now = new Date().toISOString();
        setItems((prev) =>
          prev.map((i) => (i.id === item.id && !i.readAt ? { ...i, readAt: now } : i)),
        );
      }
      void markRemoteInboxRead(item.id).catch((e) => {
        if (__DEV__) console.warn('[messages/feed] mark-read failed', e);
      });
      const href = item.href || item.sourceUrl;
      if (href && /^https?:\/\//i.test(href)) {
        void Linking.openURL(href).catch(() => {});
      }
    }, []);

    const sorted = useMemo(() => {
      return [...items].sort((a, b) => {
        const aUnread = a.readAt ? 0 : 1;
        const bUnread = b.readAt ? 0 : 1;
        if (aUnread !== bUnread) return bUnread - aUnread;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    }, [items]);

    return (
      <View style={styles.root}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLeft, { color: fold.muted }]}>为你挑选 · 基于近期节奏</Text>
          <Text style={[styles.metaRight, { color: '#8B6126' }]}>
            {unreadCount > 0 ? `未读 ${unreadCount}` : '已读完'}
          </Text>
        </View>

        {sorted.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.emptyList}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <ScreenEmptyState
              icon="article"
              title="暂无资讯"
              subtitle="下拉刷新；内容将由采集推送填充"
              style={styles.empty}
            />
          </ScrollView>
        ) : (
          <FlatList
            data={sorted}
            keyExtractor={(item) => item.id}
            refreshControl={refreshControl}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListFooterComponent={
              <View style={styles.footerBlock}>
                <View style={styles.footerRow}>
                  <Text style={styles.footerHint}>共 {items.length} 篇</Text>
                </View>
                <View
                  style={[
                    styles.noteCard,
                    { borderColor: fold.line, backgroundColor: fold.card },
                  ]}>
                  <AppIcon name="refresh" size={12} color={fold.sage} />
                  <Text style={[styles.noteText, { color: fold.muted }]}>
                    下拉刷新会在顶部短暂出现骨架，不遮挡已读列表。
                  </Text>
                </View>
              </View>
            }
            renderItem={({ item, index }) => {
              const unread = !item.readAt;
              const cover = coverFor(item.id, index);
              const mins = estimateMinutes(item.body || item.title);
              const source =
                (typeof item.sourceKey === 'string' && item.sourceKey.trim()) || '折页精选';
              return (
                <FoldRiseIn
                  animate={motionOn}
                  index={Math.min(index, 6)}
                  staggerMs={50}
                  fromY={16}
                  duration={300}>
                  <Pressable
                    onPress={() => onPressItem(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${unread ? '未读，' : ''}${item.title}`}
                    style={({ pressed }) => [
                      styles.card,
                      {
                        borderColor: fold.line,
                        backgroundColor: fold.card,
                        opacity: unread ? 1 : 0.82,
                      },
                      pressed && { transform: [{ scale: 0.985 }] },
                    ]}>
                    <View
                      style={[
                        styles.cover,
                        {
                          backgroundColor: cover.bg[1],
                        },
                      ]}>
                      <AppIcon name={cover.icon} size={18} color={cover.fg} />
                    </View>
                    <View style={styles.cardMain}>
                      <View style={styles.titleRow}>
                        <Text
                          style={[styles.cardTitle, { color: '#3E4B43' }]}
                          numberOfLines={2}>
                          {item.title}
                        </Text>
                        {unread ? (
                          <View style={[styles.unreadDot, { backgroundColor: fold.clay }]} />
                        ) : null}
                      </View>
                      {item.body ? (
                        <Text style={styles.cardBody} numberOfLines={2}>
                          {item.body}
                        </Text>
                      ) : null}
                      <View style={styles.cardMeta}>
                        <Text style={styles.cardMetaText}>
                          {source} · {mins} 分钟
                          {formatMeta(item.createdAt) ? ` · ${formatMeta(item.createdAt)}` : ''}
                        </Text>
                        <View
                          style={[
                            styles.tag,
                            {
                              backgroundColor: unread ? fold.amber2 : '#EAE6DC',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.tagText,
                              { color: unread ? '#8B5A1E' : '#777B75' },
                            ]}>
                            {unread ? '新' : '已读'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Pressable>
                </FoldRiseIn>
              );
            }}
          />
        )}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: { flex: 1 },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 7,
    paddingHorizontal: 2,
  },
  metaLeft: { fontSize: 11 },
  metaRight: { fontSize: 10, fontWeight: '700' },
  emptyList: { flexGrow: 1 },
  empty: { flex: 1, paddingTop: 40 },
  listContent: { paddingBottom: 40, gap: 6 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 9,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMain: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  cardTitle: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  unreadDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  cardBody: { fontSize: 11, color: '#8F968E', marginTop: 3, lineHeight: 15 },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    gap: 6,
  },
  cardMetaText: { fontSize: 9, color: '#A5A9A1', flex: 1 },
  tag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 9, fontWeight: '700' },
  footerBlock: { marginTop: 10, gap: 8 },
  footerRow: { paddingHorizontal: 2 },
  footerHint: { fontSize: 10, color: '#A0A69D' },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noteText: { flex: 1, fontSize: 10, lineHeight: 15 },
});
