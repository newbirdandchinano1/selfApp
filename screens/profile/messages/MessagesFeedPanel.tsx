/**
 * 消息 · 资讯：TrendRadar 热点列表。
 * - 搜索：标题 / 摘要 / 渠道
 * - 分类 Tab：按 platformName（渠道）分栏，另有「全部」
 * - 下拉刷新、触底加载、本机已读、点击打开原文
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
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

export type MessagesFeedPanelHandle = {
  markAllRead: () => void;
};

type Props = {
  onStatsChange?: (stats: { total: number; unread: number }) => void;
};

const ALL_CHANNEL = '__all__';

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

function formatReportDate(ymd: string | null | undefined): string {
  const s = String(ymd ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  return `${s.slice(5, 7)}/${s.slice(8, 10)}`;
}

function channelOf(item: RemoteInboxItem): string {
  const key = String(item.sourceKey ?? '').trim();
  return key || '其他';
}

function matchesQuery(item: RemoteInboxItem, q: string): boolean {
  if (!q) return true;
  const hay = `${item.title}\n${item.body}\n${channelOf(item)}`.toLowerCase();
  return hay.includes(q);
}

export const MessagesFeedPanel = forwardRef<MessagesFeedPanelHandle, Props>(
  function MessagesFeedPanel({ onStatsChange }, ref) {
    const { fold } = useFoldTheme();
    const { animate: motionOn } = useFoldMotionGate();
    const [items, setItems] = useState<RemoteInboxItem[]>([]);
    const [reportDate, setReportDate] = useState<string | null>(null);
    const [total, setTotal] = useState(0);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const loadingMoreRef = useRef(false);

    const [searchDraft, setSearchDraft] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [channel, setChannel] = useState<string>(ALL_CHANNEL);

    const unreadCount = useMemo(() => items.filter((i) => !i.readAt).length, [items]);

    useEffect(() => {
      onStatsChange?.({ total: items.length, unread: unreadCount });
    }, [items.length, onStatsChange, unreadCount]);

    useEffect(() => {
      return () => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      };
    }, []);

    const onChangeSearch = useCallback((text: string) => {
      setSearchDraft(text);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        setSearchQuery(text.trim().toLowerCase());
      }, 220);
    }, []);

    const clearSearch = useCallback(() => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      setSearchDraft('');
      setSearchQuery('');
    }, []);

    const reload = useCallback(async () => {
      try {
        const page = await fetchRemoteInboxPage({ limit: 500 });
        setItems(Array.isArray(page?.items) ? page.items : []);
        setReportDate(page?.reportDate ?? null);
        setTotal(Number(page?.total ?? page?.items?.length ?? 0));
        setNextCursor(page?.nextCursor ?? null);
      } catch (e) {
        if (__DEV__) console.warn('[messages/feed] fetch failed', e);
        setItems([]);
        setReportDate(null);
        setTotal(0);
        setNextCursor(null);
      }
    }, []);

    useEffect(() => {
      void reload();
    }, [reload]);

    const { refreshControl } = usePullToRefresh(reload);

    const loadMore = useCallback(async () => {
      if (!nextCursor || loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
      try {
        const page = await fetchRemoteInboxPage({
          cursor: nextCursor,
          limit: 120,
          mirrorLocal: false,
        });
        const incoming = Array.isArray(page?.items) ? page.items : [];
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          const merged = [...prev];
          for (const row of incoming) {
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            merged.push(row);
          }
          return merged;
        });
        setNextCursor(page?.nextCursor ?? null);
        if (page?.total != null) setTotal(Number(page.total));
      } catch (e) {
        if (__DEV__) console.warn('[messages/feed] load more failed', e);
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }, [nextCursor]);

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

    /** 搜索命中后再做渠道聚合，避免 Tab 数字与列表脱节 */
    const searchedItems = useMemo(
      () => items.filter((i) => matchesQuery(i, searchQuery)),
      [items, searchQuery],
    );

    const channelTabs = useMemo(() => {
      const counts = new Map<string, number>();
      for (const item of searchedItems) {
        const key = channelOf(item);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const ranked = [...counts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        return a[0].localeCompare(b[0], 'zh-CN');
      });
      return [
        { key: ALL_CHANNEL, label: '全部', count: searchedItems.length },
        ...ranked.map(([key, count]) => ({ key, label: key, count })),
      ];
    }, [searchedItems]);

    useEffect(() => {
      if (channel === ALL_CHANNEL) return;
      if (!channelTabs.some((t) => t.key === channel)) {
        setChannel(ALL_CHANNEL);
      }
    }, [channel, channelTabs]);

    const filtered = useMemo(() => {
      const base =
        channel === ALL_CHANNEL
          ? searchedItems
          : searchedItems.filter((i) => channelOf(i) === channel);
      return [...base].sort((a, b) => {
        const aUnread = a.readAt ? 0 : 1;
        const bUnread = b.readAt ? 0 : 1;
        if (aUnread !== bUnread) return bUnread - aUnread;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });
    }, [channel, searchedItems]);

    const metaLeft = reportDate
      ? `热点 · ${formatReportDate(reportDate)}`
      : '热点资讯 · TrendRadar';

    const emptyTitle = searchQuery
      ? '没有匹配结果'
      : channel !== ALL_CHANNEL
        ? '该渠道暂无内容'
        : '暂无热点';
    const emptySubtitle = searchQuery
      ? '试试换个关键词，或清空搜索'
      : '下拉刷新；渠道来自各平台热榜（platformName）';

    return (
      <View style={styles.root}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLeft, { color: fold.muted }]}>{metaLeft}</Text>
          <Text style={[styles.metaRight, { color: '#8B6126' }]}>
            {unreadCount > 0 ? `未读 ${unreadCount}` : items.length > 0 ? '已读完' : '暂无'}
          </Text>
        </View>

        <View
          style={[
            styles.searchBox,
            { borderColor: fold.line, backgroundColor: fold.card },
          ]}>
          <AppIcon name="search" size={14} color={fold.muted} />
          <TextInput
            value={searchDraft}
            onChangeText={onChangeSearch}
            placeholder="搜索标题、渠道…"
            placeholderTextColor="#A5A9A1"
            style={[styles.searchInput, { color: fold.ink }]}
            returnKeyType="search"
            clearButtonMode="never"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {searchDraft.trim() ? (
            <Pressable
              onPress={clearSearch}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="清空搜索">
              <AppIcon name="close" size={14} color={fold.muted} />
            </Pressable>
          ) : null}
        </View>

        {channelTabs.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pills}
            style={styles.pillsScroll}
            keyboardShouldPersistTaps="handled">
            {channelTabs.map((tab) => {
              const on = channel === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => setChannel(tab.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [
                    styles.pill,
                    {
                      backgroundColor: on ? fold.pineButton : fold.card,
                      borderColor: on ? fold.pineButton : fold.line,
                    },
                    pressed && { transform: [{ scale: 0.96 }] },
                  ]}>
                  <Text
                    style={[
                      styles.pillText,
                      {
                        color: on ? fold.onPineButton : fold.muted,
                        fontWeight: on ? '800' : ('650' as never),
                      },
                    ]}
                    numberOfLines={1}>
                    {tab.label} {tab.count}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {filtered.length === 0 ? (
          <ScrollView
            contentContainerStyle={styles.emptyList}
            refreshControl={refreshControl}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <ScreenEmptyState
              icon="article"
              title={emptyTitle}
              subtitle={emptySubtitle}
              style={styles.empty}
            />
          </ScrollView>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            refreshControl={refreshControl}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.35}
            onEndReached={() => {
              if (channel === ALL_CHANNEL && !searchQuery) void loadMore();
            }}
            ListFooterComponent={
              <View style={styles.footerBlock}>
                <View style={styles.footerRow}>
                  <Text style={styles.footerHint}>
                    本栏 {filtered.length} 条
                    {channel === ALL_CHANNEL && total > items.length ? ` · 已载 ${items.length}/${total}` : ''}
                  </Text>
                </View>
                {loadingMore ? (
                  <ActivityIndicator size="small" color={fold.sage} style={{ marginVertical: 8 }} />
                ) : null}
                <View
                  style={[
                    styles.noteCard,
                    { borderColor: fold.line, backgroundColor: fold.card },
                  ]}>
                  <AppIcon name="refresh" size={12} color={fold.sage} />
                  <Text style={[styles.noteText, { color: fold.muted }]}>
                    分类按新闻渠道（今日头条、微博、知乎等）；搜索可筛标题与渠道。
                  </Text>
                </View>
              </View>
            }
            renderItem={({ item, index }) => {
              const unread = !item.readAt;
              const cover = coverFor(item.id, index);
              const source = channelOf(item);
              const sectionLabel = item.section === 'rss' ? 'RSS' : '热榜';
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
                        <Text style={styles.cardMetaText} numberOfLines={1}>
                          {source} · {sectionLabel}
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
  searchBox: {
    height: 34,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    paddingVertical: 0,
    minWidth: 0,
  },
  pillsScroll: { flexGrow: 0, marginBottom: 8 },
  pills: { gap: 6, paddingHorizontal: 1, paddingBottom: 1 },
  pill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 140,
  },
  pillText: { fontSize: 10 },
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
